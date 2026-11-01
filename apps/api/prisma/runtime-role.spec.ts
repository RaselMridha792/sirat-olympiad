import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROLE_ATTRIBUTES,
  passwordProblem,
  passwordStep,
  readyLine,
  scramVerifier,
} from './runtime-role';

describe('runtime-role: the role', () => {
  it("creates the role with the migration's attributes (ensureRole runs on a fresh cluster before a restore)", () => {
    const sql = readFileSync(
      join(__dirname, 'migrations', '20261031224147_runtime_role', 'migration.sql'),
      'utf8',
    );
    expect(/CREATE ROLE sirat_app ([A-Z ]+);/.exec(sql)?.[1]).toBe(ROLE_ATTRIBUTES);
  });

  it('refuses to run without DIRECT_URL in its own environment, before Prisma Client (which reads a local .env) loads', () => {
    // A preload hook makes any load of @prisma/client fail, so the script must decide before it loads Prisma Client.
    const dir = mkdtempSync(join(tmpdir(), 'runtime-role-'));
    try {
      const hook = join(dir, 'no-prisma.cjs');
      writeFileSync(
        hook,
        "const Module = require('node:module'); const load = Module._load;\n" +
          "Module._load = function (request, ...rest) { if (request === '@prisma/client') throw new Error('PRISMA_LOADED'); return load.call(this, request, ...rest); };\n",
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_OPTIONS: `--require "${hook.replace(/\\/g, '/')}"`,
      };
      delete env.DIRECT_URL;
      const apiDir = join(__dirname, '..');
      const tsxCli = require.resolve('tsx/cli', { paths: [apiDir] });
      const run = spawnSync(process.execPath, [tsxCli, 'prisma/runtime-role.ts'], {
        cwd: apiDir,
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(`${run.stdout}${run.stderr}`).not.toContain('PRISMA_LOADED');
      expect(run.stderr).toContain('runtime role: DIRECT_URL is not set');
      expect(run.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints one line that says what the role was left with (CI greps the "set" line)', () => {
    expect(readyLine('set', false)).toBe('runtime role ready: sirat_app (login and password set)');
    expect(readyLine('keep-dev', true)).toBe(
      'runtime role ready: sirat_app (development cluster: password already set, kept)',
    );
    expect(readyLine('skip-empty', false)).toBe(
      'runtime role ready: sirat_app (no login yet: POSTGRES_APP_PASSWORD is empty)',
    );
    expect(readyLine('skip-empty', true)).toBe(
      'runtime role ready: sirat_app (POSTGRES_APP_PASSWORD is empty: the existing login is kept)',
    );
  });
});

describe('runtime-role: the password rules', () => {
  it('accepts a long URL-safe value and refuses short, unsafe or placeholder ones, naming only the rule', () => {
    expect(passwordProblem('a'.repeat(31) + 'Z')).toBeNull();
    expect(passwordProblem('0123456789abcdef0123456789abcdef')).toBeNull();
    expect(passwordProblem('short')).toMatch(/32-128/);
    expect(passwordProblem('a@b:c/d?e#f%g'.repeat(4))).toMatch(/32-128/); // would break the DATABASE_URL
    expect(passwordProblem('change-me-change-me-change-me-12')).toMatch(/placeholder/);
    const secret = 'Zq9'.repeat(12);
    expect(passwordProblem(`${secret}!`) ?? '').not.toContain(secret);
  });

  it('skips an empty key, keeps the first password on the development cluster, sets it anywhere else', () => {
    expect(passwordStep({ password: '', development: true, hasPassword: false })).toBe(
      'skip-empty',
    );
    expect(passwordStep({ password: '', development: false, hasPassword: true })).toBe(
      'skip-empty',
    );
    expect(passwordStep({ password: 'x', development: true, hasPassword: true })).toBe('keep-dev');
    expect(passwordStep({ password: 'x', development: true, hasPassword: false })).toBe('set');
    expect(passwordStep({ password: 'x', development: false, hasPassword: true })).toBe('set');
  });
});

describe('runtime-role: the SCRAM-SHA-256 verifier', () => {
  it("has PostgreSQL's stored format and never contains the password", () => {
    const password = '0123456789abcdef0123456789abcdef';
    const v = scramVerifier(password);
    expect(v).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/,
    );
    expect(v).not.toContain(password);
  });

  it('is the same for the same salt and differs with a fresh salt', () => {
    const salt = Buffer.alloc(16, 7);
    expect(scramVerifier('p'.repeat(40), salt)).toBe(scramVerifier('p'.repeat(40), salt));
    expect(scramVerifier('p'.repeat(40))).not.toBe(scramVerifier('p'.repeat(40)));
  });

  it('reproduces RFC 7677\'s example exchange (password "pencil"): its client proof and server signature', () => {
    // RFC 7677 section 3 publishes the messages, the client proof (p=) and the server signature (v=). Both follow
    // from the stored key and server key in our verifier, so a wrong derivation cannot pass.
    const v = scramVerifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'));
    const [, storedB64, serverB64] = /\$([^:]+):(.+)$/.exec(v.split('$').slice(1).join('$')) ?? [];
    const storedKey = Buffer.from(storedB64 ?? '', 'base64');
    const serverKey = Buffer.from(serverB64 ?? '', 'base64');
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest('base64');
    expect(serverSignature).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    // The server's check of the client proof: ClientKey = proof XOR HMAC(StoredKey, AuthMessage); H(ClientKey) = StoredKey.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((b, i) => b ^ (clientSignature[i] ?? 0)));
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true);
  });
});
