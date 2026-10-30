import { argon2id, hash } from 'argon2';
import { ARGON2_OPTIONS, PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService (argon2id)', () => {
  it('hashes with argon2id at the configured cost, never storing the password', async () => {
    const digest = await service.hash('correct horse battery');
    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(digest).not.toContain('correct horse battery');
    expect(await service.hash('correct horse battery')).not.toBe(digest); // random salt
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const digest = await service.hash('correct horse battery');
    await expect(service.verify(digest, 'correct horse battery')).resolves.toBe(true);
    await expect(service.verify(digest, 'correct horse batterY')).resolves.toBe(false);
  });

  it('normalizes (NFKC) before hashing and verifying', async () => {
    const digest = await service.hash('ｐａｓｓｗｏｒｄ１２３!'); // full-width
    await expect(service.verify(digest, 'password123!')).resolves.toBe(true);
  });

  it('returns false instead of throwing on an unreadable hash', async () => {
    await expect(service.verify('not-a-hash', 'whatever')).resolves.toBe(false);
    await expect(service.verify('', 'whatever')).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters for re-hashing', async () => {
    expect(service.needsRehash(await service.hash('x'.repeat(12)))).toBe(false);
    const weak = await hash('x'.repeat(12), { ...ARGON2_OPTIONS, type: argon2id, timeCost: 1 });
    expect(service.needsRehash(weak)).toBe(true);
    expect(service.needsRehash('garbage')).toBe(true);
  });

  it('runs a dummy verify for unknown accounts that always fails', async () => {
    await expect(service.verifyDummy('anything at all')).resolves.toBe(false);
    await expect(service.verifyDummy('anything at all')).resolves.toBe(false); // dummy hash reused
  });
});
