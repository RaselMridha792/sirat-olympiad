import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminPaymentsMessages,
  adminSettingsMessages,
} from '../../../i18n/messages/admin-payments.ts';
import { actionProblem, parseFeeTaka, validReason, validTrxId } from './admin-payment-rules.ts';

test('the fee is whole taka from 10 to 10,000, sent as paisa; Bangla digits and thousands commas work', () => {
  assert.equal(parseFeeTaka('400'), 40000);
  assert.equal(parseFeeTaka(' 1,000 '), 100000);
  assert.equal(parseFeeTaka('৪৫০'), 45000);
  assert.equal(parseFeeTaka('10'), 1000);
  assert.equal(parseFeeTaka('10000'), 1000000);
  for (const bad of ['', '9', '10001', '400.50', '-400', '4e2', 'abc', '100000'])
    assert.equal(parseFeeTaka(bad), null, bad);
});

test('trx_id and reasons follow the API rules', () => {
  assert.equal(validTrxId(' 2b7f1c9a-1d2e-4f00-9a1b-0123456789ab '), true);
  for (const bad of ['short', 'has space inside', 'x'.repeat(65), 'semi;colon'])
    assert.equal(validTrxId(bad), false, bad);
  assert.equal(validReason('  checked  ', 3, 200), true);
  assert.equal(validReason('ab', 3, 200), false);
  assert.equal(validReason('x'.repeat(201), 3, 200), false);
});

test('refusals map to the forms own texts, never the API message', () => {
  const answer = (status: number, code: string) => ({
    status,
    body: { statusCode: status, code, message: 'ignored' },
  });
  assert.equal(actionProblem(answer(409, 'SETTING_CHANGED')), 'SETTING_CHANGED');
  assert.equal(actionProblem(answer(409, 'RECONCILE_NOT_ALLOWED')), 'RECONCILE_NOT_ALLOWED');
  assert.equal(actionProblem(answer(409, 'TRX_ID_IN_USE')), 'TRX_ID_IN_USE');
  assert.equal(actionProblem(answer(400, 'SETTING_INVALID')), 'invalid');
  assert.equal(actionProblem(answer(403, 'FORBIDDEN')), 'denied');
  assert.equal(actionProblem(answer(429, 'TOO_MANY_REQUESTS')), 'busy');
  assert.equal(actionProblem(answer(500, 'INTERNAL_SERVER_ERROR')), 'busy');
  assert.equal(actionProblem(null), 'network');
});

test('every problem has a bn and an en text in both admin forms that can show it', () => {
  for (const m of [adminSettingsMessages.en, adminSettingsMessages.bn])
    for (const p of ['SETTING_CHANGED', 'invalid', 'denied', 'busy', 'network'] as const)
      assert.ok(m.errors[p].length > 5, p);
  for (const m of [adminPaymentsMessages.en, adminPaymentsMessages.bn])
    for (const p of [
      'RECONCILE_NOT_ALLOWED',
      'TRX_ID_IN_USE',
      'denied',
      'busy',
      'network',
    ] as const)
      assert.ok(m.reconcile.errors[p].length > 5, p);
});
