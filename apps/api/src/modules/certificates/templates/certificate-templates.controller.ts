import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  CERT_TEMPLATE_LIMITS,
  type AdminCertificateTemplate,
  type AdminCertificateTemplateRow,
  type CertificateImageInfo,
  type CertificateIssueOneResult,
  type Paginated,
} from '@sirat/shared';
import type { Request, Response } from 'express';
import type { AuthUser } from '../../auth/access-token.service';
import { CurrentUser, Roles } from '../../auth/auth.decorators';
import type { Actor } from '../../exams/admin-exams.service';
import {
  CertificateIssueOneDto,
  CertificateTemplateDto,
  CertificateTemplateQueryDto,
  CertificateTemplateVersionDto,
} from './certificate-templates.dto';
import { CertificateTemplatesService } from './certificate-templates.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });
/** Admin writes per admin and minute, as the book cover's. */
const ADMIN_WRITE_TIER = { default: { limit: 20, ttl: 60_000 } };

interface UploadedImage {
  buffer: Buffer;
}

/** Certificate templates (C1; 06-API "Certificate templates"): admins only, every write audited. */
@Controller('admin/certificate-templates')
@Roles('admin')
export class AdminCertificateTemplatesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @Get()
  list(@Query() q: CertificateTemplateQueryDto): Promise<Paginated<AdminCertificateTemplateRow>> {
    return this.templates.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminCertificateTemplate> {
    return this.templates.get(id);
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Post()
  @HttpCode(201)
  create(
    @Body() body: CertificateTemplateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminCertificateTemplate> {
    return this.templates.create(actorOf(user, req), body);
  }

  /** An edit: the next version; earlier versions, and certificates issued with them, never change. */
  @Throttle(ADMIN_WRITE_TIER)
  @Post(':id/versions')
  @HttpCode(201)
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CertificateTemplateVersionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminCertificateTemplate> {
    return this.templates.newVersion(actorOf(user, req), id, body);
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminCertificateTemplate> {
    return this.templates.activate(actorOf(user, req), id);
  }
}

/** Signature images (C1): PNG or JPEG, ≤ 200 KB and 2000×1000 px; admins only. */
@Controller('admin/certificate-images')
@Roles('admin')
export class AdminCertificateImagesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  /** One file, kept in memory only (multer's default storage), as the book cover; 413 above 200 KB. */
  @Throttle(ADMIN_WRITE_TIER)
  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CERT_TEMPLATE_LIMITS.imageMaxBytes, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<CertificateImageInfo> {
    return this.templates.uploadImage(actorOf(user, req), file?.buffer);
  }

  /**
   * The bytes with their stored (sniffed) type. Never rendered as a document: nosniff, no-store, and a CSP that allows
   * nothing and sandboxes it (lead).
   */
  @Get(':id')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const image = await this.templates.image(id);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(image.data);
  }
}

/** One certificate for one student with a reason (C1), beside core's batch issue. */
@Controller('admin/certificates')
@Roles('admin')
export class AdminCertificateIssueOneController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @Throttle(ADMIN_WRITE_TIER)
  @Post('issue-one')
  @HttpCode(201)
  issueOne(
    @Body() body: CertificateIssueOneDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CertificateIssueOneResult> {
    return this.templates.issueOne(actorOf(user, req), body);
  }
}
