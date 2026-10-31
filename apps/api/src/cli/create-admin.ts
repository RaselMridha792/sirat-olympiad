/**
 * Creates the first admin (and any later one) from the command line. There is no sign-up for admins, and roles are
 * never accepted from the web (RULEBOOK §18), so an operator creates them here (RUNBOOK §13).
 *
 *   VPS:   docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps api \
 *            node dist/cli/create-admin.js --email ops@example.org --name "Ops Admin"
 *   Local: pnpm --filter @sirat/api admin:create --email ops@example.org --name "Ops Admin"
 *
 * The password is typed at a hidden prompt (twice), so the command needs a terminal (no -T with docker compose run).
 * It is never an argument or an environment variable (shell history, process list). `--password-stdin` reads the first
 * line of piped stdin instead: for tests only, since a piped password usually ends up in shell history. It must pass
 * the owner's policy. The account is created verified, with role admin, hashed with argon2id like every password; an
 * audit row records it. An existing email is refused, never changed. Prints the new user id only.
 */
import { Prisma, PrismaClient, Role } from '@prisma/client';
import { passwordProblem } from '../modules/auth/password-policy';
import { PasswordService } from '../modules/auth/password.service';

/** A message that is safe to show the operator (never the password). */
export class AdminCliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const USAGE = 'Usage: create-admin --email <address> --name "<full name>"';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLICY_MESSAGES = {
  too_short: 'The password must be at least 8 characters.',
  too_long: 'The password must be at most 128 characters.',
  too_common: 'This password is too common. Choose another one.',
} as const;

export interface AdminInput {
  email: string;
  name: string;
}

export interface AdminArgs extends AdminInput {
  /** `--password-stdin`: the first line of piped stdin instead of the prompt (tests only). */
  passwordStdin: boolean;
}

export function parseArgs(argv: readonly string[]): AdminArgs {
  const values: Record<string, string> = {};
  let passwordStdin = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--email' || flag === '--name') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new AdminCliError(`${flag} needs a value. ${USAGE}`, 2);
      values[flag.slice(2)] = value;
      i += 1;
    } else if (flag === '--password-stdin') {
      passwordStdin = true;
    } else if (flag.startsWith('--password')) {
      // Also --password=...: the value is never repeated back.
      throw new AdminCliError(
        'Never pass the password as an argument; you will be asked for it.',
        2,
      );
    } else {
      // Only a flag-like word is repeated back: a stray value could be a password typed in the wrong place.
      const shown = /^--[a-z-]+$/.test(flag) ? ` ${flag}` : '';
      throw new AdminCliError(`Unknown argument${shown}. ${USAGE}`, 2);
    }
  }
  const email = (values.email ?? '').trim().toLowerCase();
  const name = (values.name ?? '').trim();
  if (!email || !name) throw new AdminCliError(USAGE, 2);
  if (!EMAIL.test(email) || email.length > 254)
    throw new AdminCliError('That is not a valid email address.');
  if (name.length > 100) throw new AdminCliError('The name must be at most 100 characters.');
  return { email, name, passwordStdin };
}

/** Creates the admin in one transaction with its audit row; returns the new user id. */
export async function createAdmin(
  prisma: PrismaClient,
  input: AdminInput,
  password: string,
  passwords = new PasswordService(),
): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new AdminCliError(POLICY_MESSAGES[problem]);
  const passwordHash = await passwords.hash(password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: Role.admin,
          passwordHash,
          emailVerifiedAt: new Date(), // created by an operator: no verification email (U26)
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'admin.created',
          entityType: 'user',
          entityId: user.id,
          meta: { via: 'cli' },
        },
      });
      return user.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw new AdminCliError('An account with this email already exists. Nothing was changed.');
    throw e;
  }
}

/**
 * The password: a hidden prompt (twice) on a terminal; with `fromStdin`, the first line of piped stdin. Without a
 * terminal and without the flag it stops at once, instead of waiting for stdin with no prompt on screen.
 */
export async function readPassword(
  fromStdin: boolean,
  stdin: NodeJS.ReadStream = process.stdin,
): Promise<string> {
  if (fromStdin) {
    if (stdin.isTTY)
      throw new AdminCliError(
        '--password-stdin needs piped input. At a terminal, leave it out and type the password at the prompt.',
        2,
      );
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Buffer));
    return (Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '').replace(/\r$/, '');
  }
  if (!stdin.isTTY)
    throw new AdminCliError(
      'The hidden password prompt needs a terminal. Run the command in a terminal (with docker compose run, without -T).',
      2,
    );
  const first = await promptHidden(stdin, 'Password: ');
  const second = await promptHidden(stdin, 'Repeat the password: ');
  if (first !== second) throw new AdminCliError('The two passwords differ. Nothing was changed.');
  return first;
}

function promptHidden(stdin: NodeJS.ReadStream, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new AdminCliError('Cancelled.', 130)); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const password = await readPassword(args.passwordStdin);
  const prisma = new PrismaClient();
  try {
    const id = await createAdmin(prisma, { email: args.email, name: args.name }, password);
    process.stdout.write(`Admin created: ${id}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    const known = e instanceof AdminCliError;
    process.stderr.write(
      `${known ? e.message : 'Could not create the admin (unexpected error).'}\n`,
    );
    process.exit(known ? e.exitCode : 1);
  });
}
