import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StartRegistrationDto } from '../../payments/registration/dto/start-registration.dto';
import { UpdateProfileDto } from './profile.dto';

/** A valid registration form; one field at a time is replaced by a sample. */
const REGISTRATION = {
  startRequestId: randomUUID(),
  name: 'Rahim Uddin',
  phone: '01712345678',
  email: 'rahim@test.invalid',
  password: 'correct horse battery staple',
  district: 'Dhaka',
  institution: 'Dhaka College',
  educationType: 'Bangla Medium (Bangla & English Version)',
  gradeLevelId: randomUUID(),
};

const accepts = (Dto: new () => object, body: Record<string, unknown>, field: string) => {
  const dto = plainToInstance(Dto, body);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  return {
    ok: !errors.some((e) => e.property === field),
    value: (dto as Record<string, unknown>)[field],
  };
};

const SAMPLES: Record<string, unknown[]> = {
  name: ['Al', 'A', '  Rahim   Uddin  ', 'x'.repeat(100), 'x'.repeat(101), 'রহিম উদ্দিন', 7],
  phone: [
    '01712345678',
    '+8801712345678',
    '8801712345678',
    '017-1234 5678',
    '01212345678',
    '0171234567',
    '১৭১২',
  ],
  district: ['Dhaka', "Cox's Bazar", 'dhaka', 'Calcutta', ''],
  institution: ['AB', 'A', 'x'.repeat(150), 'x'.repeat(151), '  Dhaka   College '],
  educationType: ['English Medium (IGCSE & IB)', 'english medium', 'Other'],
};

describe('UpdateProfileDto follows the registration form field for field', () => {
  for (const [field, samples] of Object.entries(SAMPLES)) {
    it.each(samples.map((s) => [s]))(`${field}: %p`, (sample) => {
      const registration = accepts(
        StartRegistrationDto,
        { ...REGISTRATION, [field]: sample },
        field,
      );
      const profile = accepts(UpdateProfileDto, { [field]: sample }, field);
      expect(profile.ok).toBe(registration.ok);
      if (registration.ok) expect(profile.value).toEqual(registration.value); // the same normalised value
    });
  }

  it('refuses every field the profile does not own', () => {
    for (const field of [
      'email',
      'gradeLevelId',
      'role',
      'category',
      'promoCode',
      'userId',
      'isBlocked',
    ]) {
      const errors = validateSync(plainToInstance(UpdateProfileDto, { [field]: 'x' }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((e) => e.property)).toContain(field);
    }
  });
});
