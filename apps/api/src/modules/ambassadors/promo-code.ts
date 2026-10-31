import { randomInt } from 'node:crypto';

/** Crockford base32 without I, L, O, U: no letter a student can misread as a digit or as another letter. */
export const PROMO_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 6;

/** `SR-` + 6 random Crockford characters (about 1.07 billion codes): fits payments' ^[A-Za-z0-9_-]{3,40}$. */
export function newPromoCode(): string {
  let code = 'SR-';
  for (let i = 0; i < LENGTH; i += 1) code += PROMO_ALPHABET[randomInt(PROMO_ALPHABET.length)];
  return code;
}
