// The load students' participant IDs (participant-ID login, docs/plans/PARTICIPANT-LOGIN-PLAN.md): the same derivation
// as loadParticipantId() in apps/api/prisma/fixtures/loadtest-fixtures.ts, from the load secret (PASSWORD here,
// FIXTURE_PASSWORD there): the student's number in 5 digits (so two load students never share an ID), 5 digits of
// HMAC-SHA256(secret, "load<n>"), then the Damm check digit. Keep both in step.
import crypto from 'k6/crypto';

const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

function damm(digits) {
  let interim = 0;
  for (const ch of digits) interim = DAMM[interim][Number(ch)];
  return interim;
}

export function loadParticipantId(secret, n) {
  const mac = crypto.hmac('sha256', secret, `load${n}`, 'hex');
  const digits =
    String(n).padStart(5, '0') + String(parseInt(mac.slice(0, 8), 16) % 100000).padStart(5, '0');
  return `ON${digits}${damm(digits)}`;
}
