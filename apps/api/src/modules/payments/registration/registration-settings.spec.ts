import { BD_DISTRICTS, EDUCATION_TYPES } from '@sirat/shared';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StartRegistrationDto } from './dto/start-registration.dto';
import { isRegistrationOpen, parseRegistrationSettings, validFee } from './registration-settings';

describe('validFee (plan 3.2)', () => {
  it.each([1_000, 40_000, 50_000, 1_000_000])('accepts %p paisa', (fee) => {
    expect(validFee(fee)).toBe(fee);
  });
  it.each([0, -40_000, 40_050, 900, 1_000_100, 400.5, '40000', null, true])('refuses %p', (fee) => {
    expect(validFee(fee)).toBeNull();
  });
});

describe('registration settings', () => {
  const rows = (over: Record<string, unknown> = {}) =>
    Object.entries({
      registration_open: true,
      registration_opens_at: null,
      registration_closes_at: null,
      registration_fee_minor: 40000,
      currency: 'BDT',
      payment_expiry_minutes: 60,
      ...over,
    }).map(([key, value]) => ({ key, value: value as never }));
  const now = new Date('2026-11-10T06:00:00Z');

  it('is open when the switch is on and now is inside the window', () => {
    expect(isRegistrationOpen(parseRegistrationSettings(rows()), now)).toBe(true);
    expect(
      isRegistrationOpen(
        parseRegistrationSettings(
          rows({
            registration_opens_at: '2026-11-10T05:00:00Z',
            registration_closes_at: '2026-11-10T07:00:00Z',
          }),
        ),
        now,
      ),
    ).toBe(true);
  });

  it.each([
    ['the switch is off', { registration_open: false }],
    ['before opens_at', { registration_opens_at: '2026-11-10T06:00:01Z' }],
    ['at closes_at', { registration_closes_at: '2026-11-10T06:00:00Z' }],
    ['the switch is not exactly true', { registration_open: 'true' }],
  ])('is closed when %s', (_label, over) => {
    expect(isRegistrationOpen(parseRegistrationSettings(rows(over)), now)).toBe(false);
  });

  it('reads an invalid fee as null and an odd expiry as 10 minutes (the link lifetime)', () => {
    const s = parseRegistrationSettings(
      rows({ registration_fee_minor: 1_000_100, payment_expiry_minutes: 0 }),
    );
    expect(s.feeMinor).toBeNull();
    expect(s.expiryMinutes).toBe(10);
    expect(parseRegistrationSettings(rows({ payment_expiry_minutes: 90 })).expiryMinutes).toBe(90);
  });
});

describe('StartRegistrationDto (plan Q2, owner-approved fields)', () => {
  const valid = {
    startRequestId: '0190f0d0-0000-7000-8000-000000000001',
    name: '  Ayesha   Rahman ',
    phone: '+880 1712-345678',
    email: ' Ayesha@Example.ORG ',
    password: 'Blue-river-moon-42',
    district: 'Dhaka',
    institution: 'Sirat School',
    educationType: EDUCATION_TYPES[0],
    gradeLevelId: '0190f0d0-0000-7000-8000-000000000002',
  };
  const check = (body: Record<string, unknown>) => {
    const dto = plainToInstance(StartRegistrationDto, body);
    return { dto, errors: validateSync(dto).map((e) => e.property) };
  };

  it('normalises the phone, the email and spaces in the name', () => {
    const { dto, errors } = check(valid);
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({
      phone: '01712345678',
      email: 'ayesha@example.org',
      name: 'Ayesha Rahman',
    });
  });

  it.each([
    ['phone', '01212345678'],
    ['phone', '1712345678'],
    ['email', 'not-an-email'],
    ['password', 'short'],
    ['password', 'password1'],
    ['district', 'Dacca'],
    ['educationType', 'Other'],
    ['gradeLevelId', 'class-8'],
    ['startRequestId', 'x'],
    ['name', 'A'],
    ['promoCode', 'has space'],
  ])('refuses %s = %p', (field, value) => {
    expect(check({ ...valid, [field]: value }).errors).toContain(field);
  });

  it('has 64 unique districts and the 5 education types', () => {
    expect(BD_DISTRICTS).toHaveLength(64);
    expect(new Set(BD_DISTRICTS).size).toBe(64);
    expect(EDUCATION_TYPES).toHaveLength(5);
  });
});
