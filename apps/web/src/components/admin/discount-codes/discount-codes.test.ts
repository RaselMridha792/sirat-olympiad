import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../../lib/api.ts';
import { discountCodeProblem } from './discount-code-problem.ts';
import {
  EMPTY_CODE,
  fromLocalInput,
  generatedCode,
  invalidField,
  toBody,
  toLocalInput,
  valuesOf,
} from './discount-code-form.ts';

const DHAKA = -360; // Date#getTimezoneOffset() in Dhaka (UTC+6)

test('each refusal of a discount-code write gets its own message', () => {
  const refused = (status: number, code?: string) =>
    new ApiRequestError(status, { statusCode: status, code: code ?? 'X', message: 'x' });
  for (const code of ['CODE_INVALID', 'VALUE_INVALID', 'CODE_TAKEN', 'CODE_LOCKED', 'CODE_IN_USE'])
    assert.equal(discountCodeProblem(refused(code === 'CODE_INVALID' ? 400 : 409, code)), code);
  assert.equal(discountCodeProblem(refused(400)), 'invalid');
  assert.equal(discountCodeProblem(refused(403)), 'failed');
  assert.equal(discountCodeProblem(new TypeError('Failed to fetch')), 'failed');
});

test('Generate makes DC- + 8 Crockford characters', () => {
  const code = generatedCode((n) => new Uint8Array(n).map((_, i) => i * 37));
  assert.match(code, /^DC-[0-9A-HJKMNP-TV-Z]{8}$/);
});

test('local times round-trip through ISO instants (Dhaka)', () => {
  assert.equal(fromLocalInput('2026-11-20T10:00', DHAKA), '2026-11-20T04:00:00.000Z');
  assert.equal(toLocalInput('2026-11-20T04:00:00.000Z', DHAKA), '2026-11-20T10:00');
  assert.equal(fromLocalInput('', DHAKA), null);
  assert.equal(fromLocalInput('not a date', DHAKA), null);
  assert.equal(toLocalInput(null, DHAKA), '');
});

test('the body: taka to paisa, empty fields to null, the code only on create', () => {
  const v = {
    ...EMPTY_CODE,
    code: 'eid2026',
    value: '50',
    maxUses: '100',
    startsAt: '2026-11-20T10:00',
    note: '  Eid  ',
  };
  assert.deepEqual(toBody(v, 'u1', DHAKA, 'create'), {
    code: 'EID2026',
    kind: 'amount',
    value: 5000,
    maxUses: 100,
    startsAt: '2026-11-20T04:00:00.000Z',
    endsAt: null,
    active: true,
    ambassadorUserId: 'u1',
    note: 'Eid',
  });
  const percent = toBody(
    { ...v, kind: 'percent', value: '20', maxUses: '', note: '' },
    null,
    0,
    'edit',
  );
  assert.equal(percent.code, undefined);
  assert.deepEqual([percent.value, percent.maxUses, percent.note], [20, null, null]);
});

test('the form refuses a value or a limit that is not a whole number in range', () => {
  assert.equal(invalidField({ ...EMPTY_CODE, value: '50' }), null);
  assert.equal(invalidField({ ...EMPTY_CODE, value: '50.5' }), 'value');
  assert.equal(invalidField({ ...EMPTY_CODE, value: '0' }), 'value');
  assert.equal(invalidField({ ...EMPTY_CODE, kind: 'percent', value: '100' }), 'value');
  assert.equal(invalidField({ ...EMPTY_CODE, kind: 'percent', value: '99' }), null);
  assert.equal(invalidField({ ...EMPTY_CODE, value: '5', maxUses: '0' }), 'maxUses');
});

test('an existing code fills the form in taka and local time', () => {
  const v = valuesOf(
    {
      id: 'x',
      code: 'DC-7K2M9QXR',
      kind: 'amount',
      value: 5000,
      maxUses: null,
      startsAt: null,
      endsAt: '2026-12-01T00:00:00.000Z',
      active: false,
      note: null,
      ambassador: { userId: 'u', name: 'N', promoCode: 'SR-4FQ2ZD' },
      uses: { paid: 0, live: 0 },
      locked: false,
      status: 'inactive',
      demo: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    DHAKA,
  );
  assert.deepEqual(v, {
    code: 'DC-7K2M9QXR',
    kind: 'amount',
    value: '50',
    maxUses: '',
    startsAt: '',
    endsAt: '2026-12-01T06:00',
    active: false,
    ambassadorCode: 'SR-4FQ2ZD',
    note: '',
  });
});
