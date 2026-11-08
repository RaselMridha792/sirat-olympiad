import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  REQUIREMENT_CACHE_MS,
  TwoFactorRequirement,
  normalizeRoles,
  parseRequiredRoles,
  rolesLabel,
} from './two-factor-requirement';
import { TwoFactorConfig } from './two-factor.config';

/* The read path of the admin 2FA requirement (DECISIONS "The admin 2FA requirement is a setting"), on a fake row. */

const config = (on = true) => {
  const env: Partial<EnvVars> = on ? { TOTP_ENCRYPTION_KEY: randomBytes(32).toString('hex') } : {};
  return new TwoFactorConfig({
    get: (name: keyof EnvVars) => env[name],
  } as unknown as ConfigService<EnvVars, true>);
};

let now = 1_000_000;
let read: jest.Mock<Promise<{ value: unknown } | null>, []>;
let logged: jest.SpyInstance;

function requirement(on = true) {
  const prisma = { setting: { findUnique: read } } as unknown as PrismaService;
  return new TwoFactorRequirement(prisma, config(on));
}
const row = (value: unknown) => read.mockResolvedValue({ value });

beforeEach(() => {
  read = jest.fn(async () => null);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('TwoFactorRequirement.requiredFor', () => {
  it('a missing row requires admin and manager', async () => {
    const r = requirement();
    expect(await r.requiredFor('admin')).toBe(true);
    expect(await r.requiredFor('manager')).toBe(true);
  });

  it('follows the row: none, admin only, both', async () => {
    row([]);
    expect(await requirement().requiredFor('admin')).toBe(false);
    row(['admin']);
    const r = requirement();
    expect(await r.requiredFor('admin')).toBe(true);
    expect(await r.requiredFor('manager')).toBe(false);
    row(['manager', 'admin']);
    expect(await requirement().requiredFor('manager')).toBe(true);
  });

  it('fails closed on a database error, and does not keep that answer', async () => {
    read.mockRejectedValueOnce(new Error('connection refused'));
    const r = requirement();
    row([]);
    expect(await r.requiredFor('admin')).toBe(true);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('connection refused');
    expect(await r.requiredFor('admin')).toBe(false); // read again at once
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('fails closed on an unreadable value', async () => {
    for (const value of ['admin', null, ['admin', 'jury'], [1], { admin: true }]) {
      row(value);
      expect(await requirement().requiredFor('manager')).toBe(true);
    }
    expect(logged).toHaveBeenCalledTimes(5);
  });

  it(`keeps what it read for ${REQUIREMENT_CACHE_MS} ms per replica, then reads again`, async () => {
    row([]);
    const r = requirement();
    expect(await r.requiredFor('admin')).toBe(false);
    row(['admin', 'manager']);
    now += REQUIREMENT_CACHE_MS - 1;
    expect(await r.requiredFor('admin')).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await r.requiredFor('admin')).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('invalidate() drops the copy at once', async () => {
    row([]);
    const r = requirement();
    expect(await r.requiredFor('admin')).toBe(false);
    row(['admin']);
    r.invalidate();
    expect(await r.requiredFor('admin')).toBe(true);
  });

  it('concurrent callers share one read; a read that started before invalidate() is not kept', async () => {
    let release: (v: { value: unknown }) => void = () => undefined;
    read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const r = requirement();
    const first = [r.requiredFor('admin'), r.requiredFor('manager')];
    expect(read).toHaveBeenCalledTimes(1);
    r.invalidate(); // a change committed while the old read was on its way
    row(['manager']);
    const after = r.requiredFor('admin');
    release({ value: [] });
    expect(await Promise.all(first)).toEqual([false, false]);
    expect(await after).toBe(false); // the new read: manager only
    expect(await r.requiredFor('manager')).toBe(true); // kept from the new read, not the old one
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never reads for a role that cannot enrol, nor while 2FA is off', async () => {
    const r = requirement();
    for (const role of ['student', 'ambassador', 'jury'] as const)
      expect(await r.requiredFor(role)).toBe(false);
    expect(await requirement(false).requiredFor('admin')).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the requirement value', () => {
  it('is normalised: known roles, no duplicates, in a fixed order', () => {
    expect(normalizeRoles(['manager', 'admin', 'manager'])).toEqual(['admin', 'manager']);
    expect(parseRequiredRoles(['manager'])).toEqual(['manager']);
    expect(parseRequiredRoles([])).toEqual([]);
    expect(parseRequiredRoles(['student'])).toBeNull();
    expect(parseRequiredRoles('admin')).toBeNull();
    expect(rolesLabel(['admin', 'manager'])).toBe('admin,manager');
    expect(rolesLabel([])).toBe('none');
  });
});
