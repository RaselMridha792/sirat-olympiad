import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfileOptions } from '@sirat/shared';
import { parseProfileForm } from './profile.ts';

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
