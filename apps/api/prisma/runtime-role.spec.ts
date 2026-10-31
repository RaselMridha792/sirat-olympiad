import { createHash, createHmac } from 'node:crypto';
import { passwordProblem, passwordStep, scramVerifier } from './runtime-role';

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
    expect(passwordStep({ password: '', development: true, hasPassword: false })).toBe('skip-empty');
    expect(passwordStep({ password: '', development: false, hasPassword: true })).toBe('skip-empty');
    expect(passwordStep({ password: 'x', development: true, hasPassword: true })).toBe('keep-dev');
    expect(passwordStep({ password: 'x', development: true, hasPassword: false })).toBe('set');
    expect(passwordStep({ password: 'x', development: false, hasPassword: true })).toBe('set');
  });
});

describe('runtime-role: the SCRAM-SHA-256 verifier', () => {
  it("has PostgreSQL's stored format and never contains the password", () => {
    const password = '0123456789abcdef0123456789abcdef';
    const v = scramVerifier(password);
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    expect(v).not.toContain(password);
  });

  it('is the same for the same salt and differs with a fresh salt', () => {
    const salt = Buffer.alloc(16, 7);
    expect(scramVerifier('p'.repeat(40), salt)).toBe(scramVerifier('p'.repeat(40), salt));
    expect(scramVerifier('p'.repeat(40))).not.toBe(scramVerifier('p'.repeat(40)));
  });

  it("reproduces RFC 7677's example exchange (password \"pencil\"): its client proof and server signature", () => {
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
