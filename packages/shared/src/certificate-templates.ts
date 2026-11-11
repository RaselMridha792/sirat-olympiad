import type { CertificateType } from './core';

/*
 * Certificate templates and the manual issue (C1; DECISIONS "Certificate templates"). A template is plain text in
 * English and Bangla with three placeholders, never HTML, so core's PDF renderer (C2) can lay it out in a fixed A4
 * landscape box. These limits are that box: the API checks them on save, and the renderer reads the same numbers.
 */

export const CERT_PLACEHOLDERS = ['name', 'round', 'date'] as const;
export type CertPlaceholder = (typeof CERT_PLACEHOLDERS)[number];

export const CERT_TEMPLATE_LIMITS = {
  /** A title or a body, worst case after the placeholders are filled (see certTextProblem). */
  titleMax: 120,
  bodyMax: 600,
  /** A signatory's name or title (each language). */
  signatoryTextMax: 80,
  signatoriesMax: 3,
  /**
   * Layout budget per placeholder occurrence, for the worst-case length: {name} as a name the box fits (a longer one
   * is shrunk by the renderer; name_on_certificate allows 200), {round} as rounds.name's maximum, {date} as a long
   * written date.
   */
  placeholderBudget: { name: 100, round: 60, date: 30 } as Record<CertPlaceholder, number>,
  /** Signature images: PNG or JPEG, signature-sized (bounds what a decode can inflate to). */
  imageMaxBytes: 204_800,
  imageMaxWidth: 2000,
  imageMaxHeight: 1000,
  imageMinSide: 10,
  reasonMin: 3,
  reasonMax: 200,
  /** The template list's page size: default and maximum. */
  pageSize: 20,
  pageSizeMax: 50,
} as const;

export const CERT_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export type CertImageType = (typeof CERT_IMAGE_TYPES)[number];

const PLACEHOLDER = /\{(name|round|date)\}/g;

/** The longest a text can print: the text outside its placeholders plus each placeholder's layout budget. */
export function certFilledWorstCase(text: string): number {
  let length = text.length;
  for (const m of text.matchAll(PLACEHOLDER)) {
    length += CERT_TEMPLATE_LIMITS.placeholderBudget[m[1] as CertPlaceholder] - m[0].length;
  }
  return length;
}

export type CertTextProblem = 'empty' | 'braces' | 'html' | 'too_long';

/**
 * What is wrong with a template text, or null:
 * - empty (after trimming);
 * - braces: a `{` or `}` that is not part of exactly {name}, {round} or {date};
 * - html: a `<` or `>`;
 * - too_long: more than `max` characters in the worst case after filling.
 * `placeholders: false` (a signatory's name or title) allows no placeholder at all.
 */
export function certTextProblem(
  text: string,
  max: number,
  placeholders = true,
): CertTextProblem | null {
  if (text.trim().length === 0) return 'empty';
  const rest = placeholders ? text.replace(PLACEHOLDER, '') : text;
  if (/[{}]/.test(rest)) return 'braces';
  if (/[<>]/.test(text)) return 'html';
  if ((placeholders ? certFilledWorstCase(text) : text.length) > max) return 'too_long';
  return null;
}

/** Refusal codes in ApiError.details for templates, images and the manual issue. */
export const CERT_TEMPLATE_REFUSALS = [
  /** A title, body or signatory text breaks certTextProblem (details carry the field too). */
  'template_text',
  /** A signatory names an image that does not exist. */
  'image_unknown',
  /** The upload is not a PNG or JPEG within the size and pixel caps. */
  'image_rejected',
  /** issue-one: no registered, unblocked student or ambassador with that email. */
  'unknown_user',
  /** issue-one: demo and real never mix (a demo account only in a demo round, and the other way round). */
  'demo_side',
  /** issue-one: the type does not fit the round (participation: the first round, winner: a final round). */
  'wrong_round',
  /** issue-one: that student already has this certificate for this round. */
  'already_issued',
] as const;
export type CertTemplateRefusal = (typeof CERT_TEMPLATE_REFUSALS)[number];

export interface CertificateSignatory {
  /** 1 to signatoriesMax, left to right. */
  position: number;
  nameEn: string;
  nameBn: string;
  titleEn: string;
  titleBn: string;
  /** A certificate image (the signature), or null. */
  imageId: string | null;
}

/** POST /admin/certificate-templates (a new template, version 1) and POST /:id/versions (an edit, without `type`). */
export interface CertificateTemplateInput {
  type: CertificateType;
  titleEn: string;
  titleBn: string;
  bodyEn: string;
  bodyBn: string;
  signatories: Omit<CertificateSignatory, 'position'>[];
}

/** One version, as issued certificates keep it (never changed after it is made; only `active` moves). */
export interface AdminCertificateTemplate {
  id: string;
  lineageId: string;
  version: number;
  type: CertificateType;
  titleEn: string;
  titleBn: string;
  bodyEn: string;
  bodyBn: string;
  active: boolean;
  signatories: CertificateSignatory[];
  createdAt: string;
  createdByName: string;
  /** Certificates issued with this version. */
  issuedCount: number;
}

/** GET /admin/certificate-templates: an optional type filter and the page (pageSize at most 50, default 20). */
export interface AdminCertificateTemplateQuery {
  type?: CertificateType;
  page?: number;
  pageSize?: number;
}

/** GET /admin/certificate-templates: `Paginated` rows, one per template (its versions grouped). */
export interface AdminCertificateTemplateRow {
  lineageId: string;
  type: CertificateType;
  latest: { id: string; version: number; titleEn: string; titleBn: string; createdAt: string };
  /** The version issued certificates get now, if it is one of this template's. */
  active: { id: string; version: number } | null;
  versions: number;
}

/** POST /admin/certificate-images: 201. */
export interface CertificateImageInfo {
  id: string;
  contentType: CertImageType;
  width: number;
  height: number;
  byteSize: number;
}

/** POST /admin/certificates/issue-one. */
export interface CertificateIssueOneRequest {
  email: string;
  type: CertificateType;
  roundId: string;
  reason: string;
}

/** 201: the certificate made, and the template version it carries (null when no version of the type is active). */
export interface CertificateIssueOneResult {
  certificateId: string;
  serial: string;
  templateVersion: number | null;
}
