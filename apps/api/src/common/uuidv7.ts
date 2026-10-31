import { randomBytes } from 'node:crypto';

/**
 * A UUIDv7 (RFC 9562): 48-bit Unix milliseconds, then random bits. For raw-SQL inserts, which do not get Prisma's
 * `@default(uuid(7))` (DECISIONS A1 #1: time-ordered ids keep B-tree inserts local).
 */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
