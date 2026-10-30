import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfileOptions } from '@sirat/shared';
import { parseProfileForm, profileSelectOptions } from './profile.ts';

const options: ProfileOptions = {
  gradeLevels: [{ id: 'gl-06', label: 'Class 10 / MYP 5', category: 'ambassador' }],
  educationTypes: ['Bangla Medium (Bangla & English Version)'],
};

test('only allow-listed fields survive; role, email and category are dropped', () => {
  const { value, result } = parseProfileForm(
    {
      name: ' Nafis  Ahmed ',
      role: 'admin',
      email: 'x@example.com',
      category: 'achiever',
      points: 9999,
    },
    options,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(Object.keys(value).sort(), [
    'district',
    'educationType',
    'gradeLevelId',
    'institution',
    'name',
    'phone',
  ]);
  assert.equal(value.name, 'Nafis Ahmed');
});

test('name is required and length-capped', () => {
  assert.deepEqual(parseProfileForm({ name: '   ' }, options).result, {
    ok: false,
    fieldErrors: { name: 'required' },
  });
  assert.deepEqual(parseProfileForm({ name: 'x'.repeat(81) }, options).result, {
    ok: false,
    fieldErrors: { name: 'tooLong' },
  });
});

test('Bangla digits in the phone number are accepted and stored as Latin digits', () => {
  const { value, result } = parseProfileForm({ name: 'A', phone: '০১৭১২-৩৪৫৬৭৮' }, options);
  assert.deepEqual(result, { ok: true });
  assert.equal(value.phone, '01712345678');
});

test('phone must be a Bangladeshi mobile number', () => {
  assert.equal(
    parseProfileForm({ name: 'A', phone: '01712-345678' }, options).value.phone,
    '01712345678',
  );
  assert.deepEqual(parseProfileForm({ name: 'A', phone: '12345' }, options).result, {
    ok: false,
    fieldErrors: { phone: 'invalid' },
  });
});

test('a phone number with the country code is stored as 01XXXXXXXXX', () => {
  for (const phone of ['+8801712345678', '8801712345678', '+88 01712-345678', '+৮৮০১৭১২৩৪৫৬৭৮']) {
    const { value, result } = parseProfileForm({ name: 'A', phone }, options);
    assert.deepEqual(result, { ok: true }, phone);
    assert.equal(value.phone, '01712345678', phone);
  }
  assert.equal(parseProfileForm({ name: 'A', phone: '' }, options).value.phone, null);
});

test('grade and education type must come from the server option lists', () => {
  const { result } = parseProfileForm(
    { name: 'A', gradeLevelId: 'gl-99', educationType: 'Other' },
    options,
  );
  assert.deepEqual(result, {
    ok: false,
    fieldErrors: { gradeLevelId: 'invalid', educationType: 'invalid' },
  });
  assert.deepEqual(parseProfileForm({ name: 'A', gradeLevelId: 'gl-06' }, options).result, {
    ok: true,
  });
});

test('select options are the server lists when the stored values are in them', () => {
  const expected = {
    educationTypes: [
      {
        value: 'Bangla Medium (Bangla & English Version)',
        label: 'Bangla Medium (Bangla & English Version)',
      },
    ],
    gradeLevels: [{ value: 'gl-06', label: 'Class 10 / MYP 5' }],
  };
  const stored = {
    educationType: 'Bangla Medium (Bangla & English Version)',
    gradeLevel: { id: 'gl-06', label: 'Class 10 / MYP 5' },
  };
  assert.deepEqual(profileSelectOptions(stored, options), expected);
  assert.deepEqual(
    profileSelectOptions({ educationType: null, gradeLevel: null }, options),
    expected,
  );
});

test('a stored value missing from the server lists stays selectable, and saving it is refused', () => {
  const stored = {
    educationType: 'Retired Medium',
    gradeLevel: { id: 'gl-old', label: 'Old Class 9' },
  };
  const { educationTypes, gradeLevels } = profileSelectOptions(stored, options);
  assert.deepEqual(educationTypes.at(-1), { value: 'Retired Medium', label: 'Retired Medium' });
  assert.deepEqual(gradeLevels.at(-1), { value: 'gl-old', label: 'Old Class 9' });
  assert.equal(educationTypes.length, options.educationTypes.length + 1);
  assert.equal(gradeLevels.length, options.gradeLevels.length + 1);

  // Posting the kept value unchanged is an error, never a silent null.
  const { result } = parseProfileForm(
    { name: 'A', educationType: 'Retired Medium', gradeLevelId: 'gl-old' },
    options,
  );
  assert.deepEqual(result, {
    ok: false,
    fieldErrors: { educationType: 'invalid', gradeLevelId: 'invalid' },
  });
});
