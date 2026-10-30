import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

const EMAIL = 'student1@example.com';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$FAKEHASHVALUE';

type FakeRes = { status: jest.Mock; json: jest.Mock };
function run(exception: unknown) {
  const res: FakeRes = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const req = { id: 'req-123', method: 'POST', path: '/api/users' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { res, body: res.json.mock.calls[0]?.[0] as Record<string, unknown> };
}

describe('AllExceptionsFilter', () => {
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  const logged = () => JSON.stringify([...error.mock.calls, ...warn.mock.calls]);

  describe('gate: never logs Prisma error messages (they contain query arguments)', () => {
    it('known request error: logs class, code and model/target names only', () => {
      const e = new Prisma.PrismaClientKnownRequestError(
        `Unique constraint failed on the fields: (\`email\`) value ${EMAIL}`,
        {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { modelName: 'User', target: ['email'], cause: `duplicate ${EMAIL}` },
        },
      );
      const { res, body } = run(e);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
      expect(error.mock.calls[0]?.[0]).toMatchObject({
        errName: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { modelName: 'User', target: ['email'] },
      });
      expect(logged()).not.toContain(EMAIL);
      expect(logged()).not.toContain('cause');
    });

    it('validation error: the argument dump (password hash, email) never reaches the log', () => {
      const e = new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.user.create()\` invocation: { data: { email: "${EMAIL}", passwordHash: "${HASH}" } } Argument \`name\` is missing.`,
        { clientVersion: '6.19.3' },
      );
      run(e);
      expect(error.mock.calls[0]?.[0]).toMatchObject({ errName: 'PrismaClientValidationError' });
      expect(logged()).not.toContain(EMAIL);
      expect(logged()).not.toContain('FAKEHASHVALUE');
    });

    it('unknown request error (e.g. a CHECK violation with "Failing row contains") is not logged verbatim', () => {
      const e = new Prisma.PrismaClientUnknownRequestError(
        `new row violates check constraint "x" DETAIL: Failing row contains (1, ${EMAIL}, ${HASH}).`,
        { clientVersion: '6.19.3' },
      );
      run(e);
      expect(error.mock.calls[0]?.[0]).toMatchObject({
        errName: 'PrismaClientUnknownRequestError',
      });
      expect(logged()).not.toContain(EMAIL);
      expect(logged()).not.toContain('Failing row');
    });

    it('any other error: logs the class name and stack frames, never the message line', () => {
      run(new TypeError(`cannot read user input ${EMAIL}`));
      const fields = error.mock.calls[0]?.[0] as Record<string, string>;
      expect(fields.errName).toBe('TypeError');
      expect(fields.frames).toContain('    at ');
      expect(logged()).not.toContain(EMAIL);
    });
  });

  describe('gate: body-parser errors are client errors (4xx), not 500', () => {
    it.each([
      [413, 'entity.too.large', 'Payload too large'],
      [400, 'entity.parse.failed', 'Bad request'],
      [415, 'charset.unsupported', 'Unsupported media type'],
      [400, 'request.aborted', 'Bad request'],
    ])('%i %s -> "%s", logged as a warning without the body', (status, type, message) => {
      const e = Object.assign(new Error(`Unexpected token in JSON: {"password":"${HASH}"}`), {
        status,
        statusCode: status,
        expose: true,
        type,
      });
      const { res, body } = run(e);

      expect(res.status).toHaveBeenCalledWith(status);
      expect(body).toMatchObject({ statusCode: status, message });
      expect(error).not.toHaveBeenCalled();
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ type, status, path: '/api/users' });
      expect(logged()).not.toContain('FAKEHASHVALUE');
    });

    it('an error that is not exposed (server-side) stays a 500', () => {
      const e = Object.assign(new Error('internal'), { status: 500, expose: false });
      expect(run(e).res.status).toHaveBeenCalledWith(500);
      expect(error).toHaveBeenCalled();
    });
  });

  it('HttpExceptions keep their status and are not logged as errors', () => {
    const { res, body } = run(new NotFoundException());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', requestId: 'req-123' });
    expect(error).not.toHaveBeenCalled();
  });
});
