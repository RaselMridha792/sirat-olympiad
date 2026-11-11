import {
  ImageRejected,
  type ImageProblem,
  type ImageRules,
  type ImageType,
  prepareImage,
  type PreparedImage,
  sniffImageType,
} from '../../common/image-upload';

/*
 * The book cover: the system's first upload (RULEBOOK §15, docs/plans/PAYMENTS-PLAN.md 16.5). JPEG, PNG or WebP, at
 * most 800 KB, 100 to 4000 px per side, metadata stripped. The checks themselves are the shared image upload
 * (common/image-upload.ts), which the certificate signatures use too.
 */

export const COVER_MAX_BYTES = 819_200;
export const COVER_MIN_SIDE = 100;
export const COVER_MAX_SIDE = 4000;
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type CoverType = ImageType;
export type CoverProblem = ImageProblem;
/** The shared rejection, under the cover's name (book.service checks `instanceof CoverRejected`). */
export { ImageRejected as CoverRejected };
export type PreparedCover = PreparedImage;

export const COVER_RULES: ImageRules = {
  types: COVER_TYPES,
  maxBytes: COVER_MAX_BYTES,
  minSide: COVER_MIN_SIDE,
  maxWidth: COVER_MAX_SIDE,
  maxHeight: COVER_MAX_SIDE,
};

/** The type by magic bytes only. */
export const sniffCoverType = (buf: Buffer): CoverType | null => sniffImageType(buf);

/** Checks, strips and fingerprints an upload; throws CoverRejected with the reason. */
export const prepareCover = (input: Buffer): PreparedCover => prepareImage(input, COVER_RULES);
