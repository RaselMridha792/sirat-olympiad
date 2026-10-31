import type { Request, Response } from 'express';
import {
  RESUME_COOKIE,
  clearResumeCookie,
  hashResumeToken,
  newResumeToken,
  readResumeToken,
  setResumeCookie,
} from './resume-cookie';

describe('the sirat_reg cookie (plan 6.1)', () => {
  it('is a 256-bit random token, and the database keeps only its SHA-256', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, newResumeToken));
    expect(tokens.size).toBe(1_000);
    const token = newResumeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashResumeToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResumeToken(token)).not.toContain(token);
  });

  it('is httpOnly, SameSite=Lax, only for /api/registrations, 7 days, and Secure unless local plain http', () => {
    const cookie = jest.fn();
    setResumeCookie({ cookie } as unknown as Response, 'tok', true);
    expect(cookie).toHaveBeenCalledWith(RESUME_COOKIE, 'tok', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/registrations',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    const clearCookie = jest.fn();
    clearResumeCookie({ clearCookie } as unknown as Response, true);
    expect(clearCookie).toHaveBeenCalledWith(RESUME_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/registrations',
    });
  });

  it('reads only a well-formed token; anything else counts as no cookie', () => {
    const req = (value: unknown) => ({ cookies: { [RESUME_COOKIE]: value } }) as unknown as Request;
    const token = newResumeToken();
    expect(readResumeToken(req(token))).toBe(token);
    for (const bad of [
      undefined,
      '',
      'short',
      'x'.repeat(101),
      'has space here and more chars',
      42,
      ['a'],
    ])
      expect(readResumeToken(req(bad))).toBeNull();
    expect(readResumeToken({} as Request)).toBeNull();
  });
});
