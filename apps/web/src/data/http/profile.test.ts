import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const profile = {
  name: 'Rahim Uddin',
  email: 'rahim@test.invalid',
  phone: '01712345678',
  district: 'Dhaka',
  institution: 'Dhaka College',
  educationType: 'Bangla Medium (Bangla & English Version)',
  category: 'activist',
  role: 'student',
  emailVerifiedAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  gradeLevel: { id: 'g8', label: 'Class 8' },
  currentRound: null,
};
const options = {
  gradeLevels: [{ id: 'g8', label: 'Class 8', category: 'activist' }],
  educationTypes: ['Bangla Medium (Bangla & English Version)'],
  districts: ['Dhaka'],
};

test('student.getProfile reads GET /users/me and passes on only the profile fields', async () => {
  const get = fakeApi({
    '/users/me': { status: 200, body: { ...profile, passwordHash: 'canary', isBlocked: false } },
  });
  const got = await createHttpSource(get).student.getProfile();
  assert.deepEqual(got, profile);
  assert.deepEqual(get.calls, ['/users/me']);
  assert.equal(JSON.stringify(got).includes('canary'), false);
});

test('student.getProfileOptions reads the option lists, districts included', async () => {
  const get = fakeApi({
    '/content/profile-options': { status: 200, body: { ...options, extra: 'canary' } },
  });
  assert.deepEqual(await createHttpSource(get).student.getProfileOptions(), options);
});

test('a profile or option list of the wrong shape, or a refusal, is an error', async () => {
  for (const [path, body, status] of [
    ['/users/me', { ...profile, role: 'owner' }, 200],
    ['/users/me', { ...profile, gradeLevel: { id: 1 } }, 200],
    ['/users/me', null, 403],
    ['/content/profile-options', { ...options, districts: 'Dhaka' }, 200],
  ] as const) {
    const get = fakeApi({ [path]: { status, body } });
    const source = createHttpSource(get);
    const call =
      path === '/users/me' ? source.student.getProfile() : source.student.getProfileOptions();
    await assert.rejects(call, DataRequestError, path);
  }
});
