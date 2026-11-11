import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CERT_IMAGE_TYPES,
  CERT_TEMPLATE_LIMITS,
  type AdminCertificateTemplate,
  type AdminCertificateTemplateRow,
  type CertificateImageInfo,
  type CertificateIssueOneResult,
  type CertificateType,
  type CertImageType,
  type CertTemplateRefusal,
  type Paginated,
} from '@sirat/shared';
import { ImageRejected, prepareImage, type ImageRules } from '../../../common/image-upload';
import { PrismaService } from '../../../prisma/prisma.service';
import { type Actor, assertAdmin, type Tx } from '../../exams/admin-exams.service';
import type {
  CertificateIssueOneDto,
  CertificateTemplateDto,
  CertificateTemplateQueryDto,
  CertificateTemplateVersionDto,
} from './certificate-templates.dto';

const L = CERT_TEMPLATE_LIMITS;
/** Signature-sized (DECISIONS "Certificate templates"): also bounds what core's PDF decode can inflate to. */
export const CERT_IMAGE_RULES: ImageRules = {
  types: CERT_IMAGE_TYPES,
  maxBytes: L.imageMaxBytes,
  minSide: L.imageMinSide,
  maxWidth: L.imageMaxWidth,
  maxHeight: L.imageMaxHeight,
};

const refuse = (Ex: typeof BadRequestException | typeof ConflictException, ...codes: string[]) =>
  new Ex(codes as [CertTemplateRefusal, ...string[]]);

const versionSelect = {
  id: true,
  lineageId: true,
  version: true,
  type: true,
  titleEn: true,
  titleBn: true,
  bodyEn: true,
  bodyBn: true,
  active: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  signatories: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      nameEn: true,
      nameBn: true,
      titleEn: true,
      titleBn: true,
      imageId: true,
    },
  },
  _count: { select: { certificates: true } },
} satisfies Prisma.CertificateTemplateSelect;

/**
 * Certificate templates, signature images and the single manual issue (C1; DECISIONS "Certificate templates"). Admin
 * only (the controllers), every write audited in its transaction. A template is versioned: an edit makes the next
 * version, a version never changes (the database refuses it), and certificates keep the version they were issued with.
 */
@Injectable()
export class CertificateTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── images ─────────────

  /** A signature: PNG or JPEG by magic bytes, ≤ 200 KB and 2000×1000 px from the header, metadata stripped. */
  async uploadImage(actor: Actor, input: Buffer | undefined): Promise<CertificateImageInfo> {
    let image;
    try {
      image = prepareImage(input ?? Buffer.alloc(0), CERT_IMAGE_RULES);
    } catch (e) {
      if (e instanceof ImageRejected)
        throw refuse(BadRequestException, 'image_rejected', e.problem);
      throw e;
    }
    return this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const row = await tx.certificateImage.create({
        data: {
          contentType: image.contentType,
          data: new Uint8Array(image.data),
          width: image.width,
          height: image.height,
          byteSize: image.byteSize,
          sha256: image.sha256,
          uploadedById: actor.id,
        },
        select: { id: true, contentType: true, width: true, height: true, byteSize: true },
      });
      await audit(tx, actor, 'certificate_images.uploaded', 'certificate_image', row.id, {
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
      });
      return { ...row, contentType: row.contentType as CertImageType };
    });
  }

  /** The bytes and their stored type, for the admin page and core's PDF renderer. */
  async image(id: string): Promise<{ contentType: CertImageType; data: Buffer }> {
    const row = await this.prisma.certificateImage.findUnique({
      where: { id },
      select: { contentType: true, data: true },
    });
    if (!row) throw new NotFoundException('Image not found');
    return { contentType: row.contentType as CertImageType, data: Buffer.from(row.data) };
  }

  // ───────────── templates ─────────────

  /**
   * One row per template (a page of them, newest template first within each type): its latest version, the active one
   * (if it is this template's), and how many versions it has.
   */
  async list(q: CertificateTemplateQueryDto): Promise<Paginated<AdminCertificateTemplateRow>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? L.pageSize;
    const where = q.type ? Prisma.sql`WHERE "type" = ${q.type}` : Prisma.empty;
    const [count] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(DISTINCT "lineage_id") AS "total" FROM "certificate_templates" ${where}`;
    const lineages = (
      await this.prisma.$queryRaw<{ lineage_id: string }[]>`
        SELECT "lineage_id"::text AS "lineage_id" FROM "certificate_templates" ${where}
        GROUP BY "lineage_id"
        ORDER BY min("type"), min("created_at") DESC, "lineage_id"
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
    ).map((r) => r.lineage_id);
    const rows = await this.prisma.certificateTemplate.findMany({
      where: { lineageId: { in: lineages } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        lineageId: true,
        version: true,
        type: true,
        titleEn: true,
        titleBn: true,
        active: true,
        createdAt: true,
      },
    });
    const out = new Map<string, AdminCertificateTemplateRow>();
    for (const r of rows) {
      const row = out.get(r.lineageId);
      if (!row)
        out.set(r.lineageId, {
          lineageId: r.lineageId,
          type: r.type as CertificateType,
          latest: {
            id: r.id,
            version: r.version,
            titleEn: r.titleEn,
            titleBn: r.titleBn,
            createdAt: r.createdAt.toISOString(),
          },
          active: r.active ? { id: r.id, version: r.version } : null,
          versions: 1,
        });
      else {
        row.versions += 1;
        if (r.active) row.active = { id: r.id, version: r.version };
      }
    }
    return {
      items: lineages.map((id) => out.get(id)).filter((r): r is AdminCertificateTemplateRow => !!r),
      page,
      pageSize,
      total: Number(count?.total ?? 0),
    };
  }

  async get(id: string): Promise<AdminCertificateTemplate> {
    const row = await this.prisma.certificateTemplate.findUnique({
      where: { id },
      select: versionSelect,
    });
    if (!row) throw new NotFoundException('Template not found');
    return view(row);
  }

  /** A new template: version 1, not active yet. */
  async create(actor: Actor, dto: CertificateTemplateDto): Promise<AdminCertificateTemplate> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      await assertImages(tx, dto);
      const lineageId = randomUUID();
      const row = await insertVersion(tx, actor, lineageId, 1, dto.type, dto);
      await audit(tx, actor, 'certificate_templates.created', 'certificate_template', row, {
        type: dto.type,
        version: 1,
        signatories: dto.signatories.length,
      });
      return row;
    });
    return this.get(id);
  }

  /** An edit: the next version of the template `id` belongs to; the old versions stay as they are. */
  async newVersion(
    actor: Actor,
    id: string,
    dto: CertificateTemplateVersionDto,
  ): Promise<AdminCertificateTemplate> {
    const created = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const base = await tx.certificateTemplate.findUnique({
        where: { id },
        select: { lineageId: true, type: true },
      });
      if (!base) throw new NotFoundException('Template not found');
      // The template's versions, locked: two edits at once get versions n+1 and n+2, never the same number.
      const versions = await tx.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "certificate_templates" WHERE "lineage_id" = ${base.lineageId}::uuid FOR UPDATE`;
      const next = Math.max(...versions.map((v) => v.version)) + 1;
      await assertImages(tx, dto);
      const row = await insertVersion(tx, actor, base.lineageId, next, base.type, dto);
      await audit(tx, actor, 'certificate_templates.versioned', 'certificate_template', row, {
        type: base.type,
        version: next,
        from: id,
        signatories: dto.signatories.length,
      });
      return row;
    });
    return this.get(created);
  }

  /** Makes this version the one its type's certificates get from now on (the previous active one stops). */
  async activate(actor: Actor, id: string): Promise<AdminCertificateTemplate> {
    await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const row = await tx.certificateTemplate.findUnique({
        where: { id },
        select: { type: true, version: true, active: true },
      });
      if (!row) throw new NotFoundException('Template not found');
      if (row.active) return;
      // Every version of the type, locked, so two activations at once end with exactly one active.
      await tx.$queryRaw`
        SELECT "id" FROM "certificate_templates" WHERE "type" = ${row.type} FOR UPDATE`;
      const previous = await tx.certificateTemplate.findFirst({
        where: { type: row.type, active: true },
        select: { id: true, version: true },
      });
      if (previous)
        await tx.certificateTemplate.update({
          where: { id: previous.id },
          data: { active: false },
        });
      await tx.certificateTemplate.update({ where: { id }, data: { active: true } });
      await audit(tx, actor, 'certificate_templates.activated', 'certificate_template', id, {
        type: row.type,
        version: row.version,
        previous: previous?.id ?? null,
      });
    });
    return this.get(id);
  }

  // ───────────── the manual issue ─────────────

  /**
   * One certificate for one student, by an admin with a reason (C1). The student must be registered and not blocked;
   * demo and real never mix; the type must fit the round:
   * - participation: the side's first round;
   * - promotion: a later round;
   * - winner: a final round (rounds.type = 'final').
   * The eligibility snapshot of the batch issue is bypassed on purpose: the reason is audited. The serial comes from
   * certificate_serial_seq, or the demo range for a demo account; the type's active template version is pinned.
   */
  async issueOne(actor: Actor, dto: CertificateIssueOneDto): Promise<CertificateIssueOneResult> {
    return this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const user = await tx.user.findUnique({
        where: { email: dto.email },
        select: {
          id: true,
          name: true,
          role: true,
          isBlocked: true,
          demoBatchId: true,
          registration: { select: { id: true } },
        },
      });
      if (
        !user ||
        user.isBlocked ||
        (user.role !== 'student' && user.role !== 'ambassador') ||
        !user.registration
      )
        throw refuse(ConflictException, 'unknown_user');
      const round = await tx.round.findUnique({
        where: { id: dto.roundId },
        select: { id: true, type: true, sortOrder: true, demoBatchId: true },
      });
      if (!round) throw new NotFoundException('Round not found');
      if ((round.demoBatchId === null) !== (user.demoBatchId === null))
        throw refuse(ConflictException, 'demo_side');
      const first =
        (await tx.round.count({
          where: {
            demoBatchId: round.demoBatchId === null ? null : { not: null },
            sortOrder: { lt: round.sortOrder },
          },
        })) === 0;
      const fits =
        (dto.type === 'participation' && first) ||
        (dto.type === 'promotion' && !first) ||
        (dto.type === 'winner' && round.type === 'final');
      if (!fits) throw refuse(ConflictException, 'wrong_round');

      // The demo range is max + 1, not a sequence: two demo issues at once take turns (never the same serial).
      if (user.demoBatchId !== null)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('exam:certificates.demo_serial'))`;
      const serial =
        user.demoBatchId === null
          ? Prisma.sql`'SLO-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY') || '-'
              || lpad(nextval('certificate_serial_seq')::text, 6, '0')`
          : // A demo account: the demo range SLO-YYYY-9NNNNN, never the real sequence.
            Prisma.sql`'SLO-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY') || '-' || (
              SELECT (COALESCE(max(right("serial", 6)::int), 900000) + 1)::text FROM "certificates"
              WHERE "serial" ~ '^SLO-[0-9]{4}-9[0-9]{5}$')`;
      const [made] = await tx.$queryRaw<
        { id: string; serial: string; template_id: string | null }[]
      >`
        INSERT INTO "certificates"
          ("id", "user_id", "type", "round_id", "serial", "verification_code", "name_on_certificate",
           "template_id")
        VALUES (gen_random_uuid(), ${user.id}::uuid, ${dto.type}, ${round.id}::uuid, ${serial},
                upper(left(replace(gen_random_uuid()::text, '-', ''), 12)), left(${user.name}, 200),
                (SELECT t."id" FROM "certificate_templates" t WHERE t."type" = ${dto.type} AND t."active"))
        ON CONFLICT ("user_id", "type", "round_id") DO NOTHING
        RETURNING "id"::text AS "id", "serial", "template_id"::text AS "template_id"`;
      if (!made) throw refuse(ConflictException, 'already_issued');
      const version = made.template_id
        ? (
            await tx.certificateTemplate.findUniqueOrThrow({
              where: { id: made.template_id },
              select: { version: true },
            })
          ).version
        : null;
      await audit(tx, actor, 'certificates.issued_one', 'certificate', made.id, {
        type: dto.type,
        roundId: round.id,
        userId: user.id,
        serial: made.serial,
        templateVersion: version,
        reason: dto.reason,
      });
      return { certificateId: made.id, serial: made.serial, templateVersion: version };
    });
  }
}

async function assertImages(tx: Tx, dto: CertificateTemplateVersionDto): Promise<void> {
  const ids = [...new Set(dto.signatories.map((s) => s.imageId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const found = await tx.certificateImage.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw refuse(BadRequestException, 'image_unknown');
}

async function insertVersion(
  tx: Tx,
  actor: Actor,
  lineageId: string,
  version: number,
  type: string,
  dto: CertificateTemplateVersionDto,
): Promise<string> {
  const row = await tx.certificateTemplate.create({
    data: {
      lineageId,
      version,
      type,
      titleEn: dto.titleEn,
      titleBn: dto.titleBn,
      bodyEn: dto.bodyEn,
      bodyBn: dto.bodyBn,
      createdById: actor.id,
    },
    select: { id: true },
  });
  if (dto.signatories.length)
    await tx.certificateTemplateSignatory.createMany({
      data: dto.signatories.map((s, i) => ({
        templateId: row.id,
        position: i + 1,
        nameEn: s.nameEn,
        nameBn: s.nameBn,
        titleEn: s.titleEn,
        titleBn: s.titleBn,
        imageId: s.imageId ?? null,
      })),
    });
  return row.id;
}

function view(
  row: Prisma.CertificateTemplateGetPayload<{ select: typeof versionSelect }>,
): AdminCertificateTemplate {
  return {
    id: row.id,
    lineageId: row.lineageId,
    version: row.version,
    type: row.type as CertificateType,
    titleEn: row.titleEn,
    titleBn: row.titleBn,
    bodyEn: row.bodyEn,
    bodyBn: row.bodyBn,
    active: row.active,
    signatories: row.signatories,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.name,
    issuedCount: row._count.certificates,
  };
}

async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  meta: Prisma.InputJsonObject,
): Promise<void> {
  await tx.auditLog.create({
    data: { action, actorId: actor.id, entityType, entityId, ip: actor.ip, meta },
  });
}
