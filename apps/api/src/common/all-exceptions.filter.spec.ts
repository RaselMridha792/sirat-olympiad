import {
  ArgumentsHost,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter, BUSY_RETRY_AFTER_SECONDS } from './all-exceptions.filter';

const EMAIL = 'student1@example.com';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$FAKEHASHVALUE';

type FakeRes = { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
function run(exception: unknown) {
  const res: FakeRes = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
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

  it('passes on an application code a service set on purpose, so the web can pick a bn/en text', () => {
    const { res, body } = run(
      new ConflictException({
        code: 'EMAIL_REGISTERED',
        message: 'Already registered. Please log in.',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_REGISTERED',
      message: 'Already registered. Please log in.',
    });
  });

  it('ignores a code that is not an application code, and keeps the status name', () => {
    for (const code of ['email registered', 'x', 42, '<script>', 'A'.repeat(50)]) {
      const { body } = run(new ConflictException({ code, message: 'Conflict' }));
      expect(body).toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('never takes a code from anything but an HttpException our code built: Prisma, driver or plain errors', () => {
    const prisma = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['email'], code: 'EMAIL_REGISTERED' },
    });
    const plain = Object.assign(new Error('EMAIL_REGISTERED'), { code: 'EMAIL_REGISTERED' });
    const driver = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    for (const e of [prisma, plain, driver]) {
      const { res, body } = run(e);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(body).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
    }
    // A client error from the body parser keeps its fixed message and status name, whatever it carries.
    const parser = Object.assign(new Error('Unexpected token'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
      code: 'EMAIL_REGISTERED',
    });
    expect(run(parser).body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Bad request',
    });
  });
  describe('a busy database answers 503 SERVICE_BUSY with Retry-After (non-HTTP errors only)', () => {
    const known = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError(`busy ${EMAIL}`, {
        code,
        clientVersion: '6.19.3',
        meta,
      });

    it.each([
      ['P2028 (transaction maxWait or timeout)', known('P2028')],
      ['P2034 (write conflict or deadlock)', known('P2034')],
      ['P2024 (no connection from the pool)', known('P2024')],
      ['P2010 with SQLSTATE 57014 (statement timeout)', known('P2010', { code: '57014' })],
      [
        'an unknown request error with SQLSTATE 55P03 (lock timeout)',
        new Prisma.PrismaClientUnknownRequestError(`55P03 lock ${EMAIL}`, {
          clientVersion: '6.19.3',
        }),
      ],
    ])('%s', (_name, e) => {
      const { res, body } = run(e);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', String(BUSY_RETRY_AFTER_SECONDS));
      expect(body).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_BUSY',
        message: 'The service is busy. Try again in a moment.',
        requestId: 'req-123',
      });
      expect(error).not.toHaveBeenCalled();
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ msg: 'database busy', errName: e.name });
      expect(logged()).not.toContain(EMAIL); // class and code only, never the message
    });

    it.each([
      ['P2002 (a real conflict)', known('P2002')],
      ['P1017 (connection closed: maybe during COMMIT, unknown outcome)', known('P1017')],
      ['P1001 (cannot reach the database)', known('P1001')],
      ['a plain Error', new Error('boom')],
    ])('%s stays 500, with no Retry-After', (_name, e) => {
      const { res, body } = run(e);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
    });

    it("an HttpException 503 (refresh's own 'busy') passes unchanged, with no Retry-After", () => {
      const { res, body } = run(new ServiceUnavailableException('Try again'));
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(body).toMatchObject({ statusCode: 503, message: 'Try again' });
      expect(body.code).not.toBe('SERVICE_BUSY');
    });
  });
});
