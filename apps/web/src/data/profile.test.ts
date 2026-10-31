import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION_MESSAGES, type ProfileOptions } from '@sirat/shared';
import { profileMessages } from '../i18n/messages/profile.ts';
import { parseProfileForm, profileSelectOptions } from './profile.ts';

const options: ProfileOptions = {
  gradeLevels: [{ id: 'gl-06', label: 'Class 10 / MYP 5', category: 'ambassador' }],
  educationTypes: ['Bangla Medium (Bangla & English Version)'],
  districts: ['Dhaka', "Cox's Bazar"],
};

/** A complete, valid form; each test changes one field. */
const valid = {
  name: 'Nafis Ahmed',
  phone: '01712345678',
  district: 'Dhaka',
  institution: 'Dhaka College',
  educationType: 'Bangla Medium (Bangla & English Version)',
};

test('only allow-listed fields survive; role, email, grade and category are dropped', () => {
  const { value, result } = parseProfileForm(
    {
      ...valid,
      name: ' Nafis  Ahmed ',
      role: 'admin',
      email: 'x@example.com',
      gradeLevelId: 'gl-06',
      category: 'achiever',
      points: 9999,
    },
    options,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(Object.keys(value).sort(), [
    'district',
    'educationType',
    'institution',
    'name',
    'phone',
  ]);
  assert.equal(value.name, 'Nafis Ahmed');
});

test('name and institution follow the registration limits (2–100, 2–150)', () => {
  const errors = (field: string, v: string) =>
    parseProfileForm({ ...valid, [field]: v }, options).result;
  assert.deepEqual(errors('name', '   '), { ok: false, fieldErrors: { name: 'required' } });
  assert.deepEqual(errors('name', 'A'), { ok: false, fieldErrors: { name: 'tooShort' } });
  assert.deepEqual(errors('name', 'x'.repeat(101)), {
    ok: false,
    fieldErrors: { name: 'tooLong' },
  });
  assert.deepEqual(errors('name', 'x'.repeat(100)), { ok: true });
  assert.deepEqual(errors('institution', 'A'), {
    ok: false,
    fieldErrors: { institution: 'tooShort' },
  });
  assert.deepEqual(errors('institution', 'x'.repeat(151)), {
    ok: false,
    fieldErrors: { institution: 'tooLong' },
  });
});

test('a phone in any form, Bangla digits too, becomes 01XXXXXXXXX', () => {
  for (const phone of [
    '01712-345678',
    '০১৭১২-৩৪৫৬৭৮',
    '+8801712345678',
    '8801712345678',
    '+88 01712-345678',
    '+৮৮০১৭১২৩৪৫৬৭৮',
  ]) {
    const { value, result } = parseProfileForm({ ...valid, phone }, options);
    assert.deepEqual(result, { ok: true }, phone);
    assert.equal(value.phone, '01712345678', phone);
  }
});

test('the phone must be a Bangladeshi mobile number and cannot be cleared', () => {
  for (const phone of ['12345', '01212345678', '0171234567']) {
    assert.deepEqual(parseProfileForm({ ...valid, phone }, options).result, {
      ok: false,
      fieldErrors: { phone: 'invalid' },
    });
  }
  assert.deepEqual(parseProfileForm({ ...valid, phone: '' }, options).result, {
    ok: false,
    fieldErrors: { phone: 'required' },
  });
});

test('district and education type must come from the server lists', () => {
  const { result } = parseProfileForm(
    { ...valid, district: 'Calcutta', educationType: 'Other' },
    options,
  );
  assert.deepEqual(result, {
    ok: false,
    fieldErrors: { district: 'invalid', educationType: 'invalid' },
  });
  assert.deepEqual(parseProfileForm({ ...valid, district: "Cox's Bazar" }, options).result, {
    ok: true,
  });
});

test('select options are the server lists, and a stored value missing from them stays visible', () => {
  const lists = profileSelectOptions({ educationType: null, district: 'Dhaka' }, options);
  assert.deepEqual(
    lists.districts.map((d) => d.value),
    ['Dhaka', "Cox's Bazar"],
  );
  assert.equal(lists.educationTypes.length, 1);
  const kept = profileSelectOptions({ educationType: 'Retired', district: 'Old Town' }, options);
  assert.deepEqual(kept.educationTypes.at(-1), { value: 'Retired', label: 'Retired' });
  assert.deepEqual(kept.districts.at(-1), { value: 'Old Town', label: 'Old Town' });
  // Saving the kept value unchanged is refused, never silently cleared.
  assert.deepEqual(
    parseProfileForm({ ...valid, educationType: 'Retired', district: 'Old Town' }, options).result,
    { ok: false, fieldErrors: { district: 'invalid', educationType: 'invalid' } },
  );
});

test("the taken-phone message is the owner's text in both languages", () => {
  assert.equal(
    profileMessages.en.form.fieldErrors.phone.taken,
    REGISTRATION_MESSAGES.PHONE_REGISTERED!.en,
  );
  assert.equal(
    profileMessages.bn.form.fieldErrors.phone.taken,
    REGISTRATION_MESSAGES.PHONE_REGISTERED!.bn,
  );
});
