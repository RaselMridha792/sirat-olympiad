import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REGISTRATION_ERROR_CODES } from '@sirat/shared';
import { registrationMessages } from '../../i18n/messages/registration.ts';
import { isMoving, nextPollDelay, POLL_STOP_MS } from './poll.ts';
import {
  EMPTY_FORM,
  stepOf,
  toStartInput,
  validateStep,
  type FormValues,
} from './registration-form.ts';
import { problemText, registrationProblem } from './registration-problem.ts';

const choices = {
  districts: ['Dhaka', 'Khulna'],
  educationTypes: ['Bangla Medium (Bangla & English Version)'],
  gradeLevelIds: ['0190f000-0000-7000-8000-000000000005'],
};
const valid: FormValues = {
  name: '  Nafis   Ahmed ',
  phone: '+880 1712-345678',
  email: ' Nafis@Example.com ',
  password: 'Blue-river-moon-42',
  district: 'Dhaka',
  institution: ' Padma  Model School ',
  educationType: 'Bangla Medium (Bangla & English Version)',
  gradeLevelId: '0190f000-0000-7000-8000-000000000005',
  promoCode: '',
};

describe('registration form rules (the API DTO, checked before sending)', () => {
  it('accepts a complete form on both input steps', () => {
    assert.deepEqual(validateStep('you', valid, choices), {});
    assert.deepEqual(validateStep('school', valid, choices), {});
    assert.deepEqual(validateStep('review', EMPTY_FORM, choices), {});
  });

  it('names each problem on its own step', () => {
    assert.deepEqual(validateStep('you', EMPTY_FORM, choices), {
      name: 'required',
      phone: 'required',
      email: 'required',
      password: 'required',
    });
    assert.deepEqual(validateStep('school', EMPTY_FORM, choices), {
      district: 'choose',
      institution: 'required',
      educationType: 'choose',
      gradeLevelId: 'choose',
    });
    const bad = {
      ...valid,
      name: 'A',
      phone: '01212345678', // no such operator
      email: 'nafis@',
      password: 'short',
      district: 'Atlantis',
      institution: 'X',
      promoCode: 'no spaces allowed',
    };
    assert.deepEqual(validateStep('you', bad, choices), {
      name: 'name',
      phone: 'phone',
      email: 'email',
      password: 'passwordShort',
    });
    assert.deepEqual(validateStep('school', bad, choices), {
      district: 'choose',
      institution: 'institution',
      promoCode: 'promoCode',
    });
    assert.equal(
      validateStep('you', { ...valid, password: 'x'.repeat(129) }, choices).password,
      'passwordLong',
    );
    assert.equal(stepOf('email'), 'you');
    assert.equal(stepOf('promoCode'), 'school');
  });

  it('sends trimmed values, the phone as 01XXXXXXXXX, the email lowercased, and no empty promo code', () => {
    const input = toStartInput(valid, 'req-1');
    assert.deepEqual(input, {
      startRequestId: 'req-1',
      name: 'Nafis Ahmed',
      phone: '01712345678',
      email: 'nafis@example.com',
      password: 'Blue-river-moon-42',
      district: 'Dhaka',
      institution: 'Padma Model School',
      educationType: 'Bangla Medium (Bangla & English Version)',
      gradeLevelId: '0190f000-0000-7000-8000-000000000005',
    });
    assert.equal(toStartInput({ ...valid, promoCode: ' AMB-7 ' }, 'r').promoCode, 'AMB-7');
    assert.equal('role' in input, false);
  });
});

describe('registration API answers', () => {
  const answer = (status: number, code: string, details?: unknown) => ({
    status,
    body: { statusCode: status, code, message: 'ignored', details },
  });

  it("puts the owner's duplicate texts next to the email or the phone", () => {
    assert.deepEqual(registrationProblem(answer(409, 'EMAIL_REGISTERED')), {
      kind: 'field',
      field: 'email',
      text: 'EMAIL_REGISTERED',
    });
    assert.deepEqual(registrationProblem(answer(409, 'PHONE_REGISTERED')), {
      kind: 'field',
      field: 'phone',
      text: 'PHONE_REGISTERED',
    });
    assert.deepEqual(registrationProblem(answer(400, 'PROMO_INVALID')), {
      kind: 'field',
      field: 'promoCode',
      text: 'PROMO_INVALID',
    });
  });

  it('shows the other codes above the button, and never the API message', () => {
    for (const code of [
      'REGISTRATION_CLOSED',
      'PAYMENTS_PAUSED',
      'PAYMENT_START_FAILED',
      'TOO_MANY_ATTEMPTS',
    ])
      assert.deepEqual(registrationProblem(answer(409, code)), { kind: 'form', text: code });
    assert.deepEqual(registrationProblem(answer(400, 'START_REQUEST_REUSED')), {
      kind: 'newRequest',
    });
  });

  it('maps the password policy, other 400s, throttles, server errors and no answer', () => {
    assert.deepEqual(
      registrationProblem(
        answer(400, 'BAD_REQUEST', ['This password is too common. Choose another one']),
      ),
      { kind: 'field', field: 'password', text: 'passwordCommon' },
    );
    assert.deepEqual(registrationProblem(answer(400, 'BAD_REQUEST', ['name must be longer'])), {
      kind: 'form',
      text: 'invalid',
    });
    assert.deepEqual(registrationProblem(answer(429, 'TOO_MANY_REQUESTS')), {
      kind: 'form',
      text: 'busy',
    });
    assert.deepEqual(registrationProblem(answer(502, 'BAD_GATEWAY')), {
      kind: 'form',
      text: 'busy',
    });
    assert.deepEqual(registrationProblem({ status: 500, body: null }), {
      kind: 'form',
      text: 'busy',
    });
    assert.deepEqual(registrationProblem(null), { kind: 'form', text: 'network' });
  });

  it('has a bn and an en text for every registration code the start route can answer', () => {
    const notForStart = new Set([
      'NO_REGISTRATION',
      'NOTHING_TO_RESUME',
      'RETRY_NOT_ALLOWED',
      'CANNOT_CANCEL',
      'START_REQUEST_REUSED',
    ]);
    for (const code of REGISTRATION_ERROR_CODES.filter((c) => !notForStart.has(c)))
      for (const m of [registrationMessages.en, registrationMessages.bn])
        assert.ok(problemText(m, code as never).length > 5, code);
  });

  it("uses the owner's texts word for word", () => {
    assert.equal(
      registrationMessages.bn.errors.EMAIL_REGISTERED,
      'এই email দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অনুগ্রহ করে login করুন।',
    );
    assert.equal(
      registrationMessages.en.errors.PHONE_REGISTERED,
      'This phone number is already registered. Please use another number.',
    );
  });
});

describe('result page polling (plan 6.7)', () => {
  it('asks every 2 s, then 5 s, then 10 s, and stops after 2 minutes', () => {
    assert.equal(nextPollDelay(0), 2_000);
    assert.equal(nextPollDelay(19_999), 2_000);
    assert.equal(nextPollDelay(20_000), 5_000);
    assert.equal(nextPollDelay(60_000), 10_000);
    assert.equal(nextPollDelay(POLL_STOP_MS - 1), 10_000);
    assert.equal(nextPollDelay(POLL_STOP_MS), null);
  });

  it('keeps polling only while the state can still change by itself', () => {
    assert.equal(isMoving('confirming'), true);
    assert.equal(isMoving('awaiting_payment'), true);
    for (const s of ['completed', 'failed', 'expired', 'needs_help'] as const)
      assert.equal(isMoving(s), false);
  });
});
