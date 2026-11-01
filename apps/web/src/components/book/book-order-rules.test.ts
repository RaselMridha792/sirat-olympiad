import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookMessages } from '../../i18n/messages/book.ts';
import {
  bookProblem,
  initialBookValues,
  pickOrderView,
  toBookInput,
  validateBookForm,
} from './book-order-rules.ts';

const order = {
  status: 'confirmed' as const,
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  district: 'Dhaka',
  upazila: 'Mirpur',
  addressLine: 'House 12, Road 3',
  note: null,
  bookTitle: 'Book',
  version: 3,
  confirmedAt: '2026-11-01T01:00:00.000Z',
  shippedAt: null,
};

test('starts from the order, or from the student (name, phone, a known district)', () => {
  assert.equal(
    initialBookValues(order, { name: 'X', phone: null, district: null }).upazila,
    'Mirpur',
  );
  assert.deepEqual(
    initialBookValues(null, { name: 'Nafis', phone: '01811111111', district: 'Khulna' }),
    {
      recipientName: 'Nafis',
      recipientPhone: '01811111111',
      district: 'Khulna',
      upazila: '',
      addressLine: '',
      note: '',
    },
  );
  assert.equal(
    initialBookValues(null, { name: 'N', phone: null, district: 'Atlantis' }).district,
    '',
  );
});

test('checks the fields as the API does', () => {
  const ok = initialBookValues(order, { name: '', phone: null, district: null });
  assert.deepEqual(validateBookForm(ok), {});
  assert.deepEqual(
    validateBookForm({
      recipientName: ' ',
      recipientPhone: '01212345678',
      district: 'Atlantis',
      upazila: 'X',
      addressLine: 'abc',
      note: 'n'.repeat(301),
    }),
    {
      recipientName: 'required',
      recipientPhone: 'recipientPhone',
      district: 'choose',
      upazila: 'upazila',
      addressLine: 'addressLine',
      note: 'note',
    },
  );
});

test('always sends the version once an order exists; normalises the phone; no empty note', () => {
  const v = {
    ...initialBookValues(order, { name: '', phone: null, district: null }),
    recipientPhone: '+880 1712-345678',
  };
  assert.deepEqual(toBookInput(v, order), {
    recipientName: 'Rahim Uddin',
    recipientPhone: '01712345678',
    district: 'Dhaka',
    upazila: 'Mirpur',
    addressLine: 'House 12, Road 3',
    expectedVersion: 3,
  });
  assert.equal('expectedVersion' in toBookInput(v, null), false);
  assert.equal(toBookInput({ ...v, note: '  Call   first ' }, null).note, 'Call first');
});

test('maps the API codes; every problem has a bn and an en text', () => {
  const answer = (status: number, code: string) => ({
    status,
    body: { statusCode: status, code, message: 'x' },
  });
  assert.equal(bookProblem(answer(403, 'BOOK_NOT_ELIGIBLE')), 'BOOK_NOT_ELIGIBLE');
  assert.equal(bookProblem(answer(409, 'BOOK_ORDER_SHIPPED')), 'BOOK_ORDER_SHIPPED');
  assert.equal(bookProblem(answer(409, 'BOOK_ORDER_CHANGED')), 'BOOK_ORDER_CHANGED');
  assert.equal(bookProblem(answer(400, 'BAD_REQUEST')), 'invalid');
  assert.equal(bookProblem(answer(500, 'INTERNAL_SERVER_ERROR')), 'busy');
  assert.equal(bookProblem(null), 'network');
  for (const m of [bookMessages.en, bookMessages.bn])
    for (const text of Object.values(m.errors)) assert.ok(text.length > 5);
});

test('only the order fields cross to the client form', () => {
  const leaky = { ...order, userId: 'canary-user', passwordHash: 'canary' } as typeof order;
  assert.deepEqual(pickOrderView(leaky), order);
});
