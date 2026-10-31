import { CATEGORIES, ROLES, type ProfileOptions, type StudentProfile } from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, type ApiGet } from './request.ts';

/*
 * The student's own profile and its form options (core session; 06-API "Student profile"). Reads only: the save
 * is a browser write through lib/api.ts (ProfileForm). Shapes are checked and picked field by field.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

function isProfile(v: unknown): v is StudentProfile {
  if (!isRecord(v)) return false;
  const grade = v.gradeLevel;
  const round = v.currentRound;
  return (
    text(v.name) &&
    text(v.email) &&
    textOrNull(v.phone) &&
    textOrNull(v.district) &&
    textOrNull(v.institution) &&
    textOrNull(v.educationType) &&
    (v.category === null || (CATEGORIES as readonly unknown[]).includes(v.category)) &&
    (ROLES as readonly unknown[]).includes(v.role) &&
    textOrNull(v.emailVerifiedAt) &&
    text(v.createdAt) &&
    (grade === null || (isRecord(grade) && text(grade.id) && text(grade.label))) &&
    (round === null || (isRecord(round) && text(round.id) && text(round.name)))
  );
}

function isOptions(v: unknown): v is ProfileOptions {
  return (
    isRecord(v) &&
    Array.isArray(v.gradeLevels) &&
    v.gradeLevels.every(
      (g) =>
        isRecord(g) &&
        text(g.id) &&
        text(g.label) &&
        (CATEGORIES as readonly unknown[]).includes(g.category),
    ) &&
    textList(v.educationTypes) &&
    textList(v.districts)
  );
}

export function studentProfile(
  get: ApiGet,
): Pick<DataSource['student'], 'getProfile' | 'getProfileOptions'> {
  return {
    /** GET /users/me */
    async getProfile() {
      const p = await getJson(get, '/users/me', isProfile);
      return {
        name: p.name,
        email: p.email,
        phone: p.phone,
        district: p.district,
        institution: p.institution,
        educationType: p.educationType,
        category: p.category,
        role: p.role,
        emailVerifiedAt: p.emailVerifiedAt,
        createdAt: p.createdAt,
        gradeLevel: p.gradeLevel && { id: p.gradeLevel.id, label: p.gradeLevel.label },
        currentRound: p.currentRound && { id: p.currentRound.id, name: p.currentRound.name },
      };
    },
    /** GET /content/profile-options */
    async getProfileOptions() {
      const o = await getJson(get, '/content/profile-options', isOptions);
      return {
        gradeLevels: o.gradeLevels.map((g) => ({ id: g.id, label: g.label, category: g.category })),
        educationTypes: [...o.educationTypes],
        districts: [...o.districts],
      };
    },
  };
}
