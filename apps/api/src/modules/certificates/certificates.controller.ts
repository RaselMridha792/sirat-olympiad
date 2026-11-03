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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CERTIFICATE_LIMITS,
  type AdminCertificateRow,
  type CertificateCheck,
  type CertificateIssueResult,
  type MyCertificate,
  type Paginated,
} from '@sirat/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import { type Actor, CertificatesService } from './certificates.service';
import {
  AdminCertificateQueryDto,
  IssueCertificatesDto,
  RevokeCertificateDto,
} from './dto/certificates.dto';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });

/** The public check, per IP (no session): codes are random, and this keeps guessing slow (lead). */
const CHECK_TIER = { default: { limit: CERTIFICATE_LIMITS.checksPerMinute, ttl: 60_000 } };

/** The student's own certificates (06-API "Certificates", core C6c). No id: the user comes from the session. */
@Controller('certificates')
@Roles('student', 'ambassador')
export class MyCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser): Promise<MyCertificate[]> {
    return this.certificates.mine(user.id);
  }
}

/** Anyone may check a certificate by its code: the name and the award only (reviewed public allow-list). */
@Controller('certificates')
export class CertificateCheckController {
  constructor(private readonly certificates: CertificatesService) {}

  @Public()
  @Throttle(CHECK_TIER)
  @Get('verify/:code')
  check(@Param('code') code: string): Promise<CertificateCheck> {
    return this.certificates.check(code);
  }
}

/** Certificates for admins (core C6c): the issue run (queued), the list, the revoke; every write audited. */
@Controller('admin/certificates')
@Roles('admin')
export class AdminCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  list(
    @Query() query: AdminCertificateQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AdminCertificateRow>> {
    return this.certificates.list(user.id, query);
  }

  @Post('issue')
  @HttpCode(202)
  issue(
    @Body() body: IssueCertificatesDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CertificateIssueResult> {
    return this.certificates.issue(body, actorOf(user, req));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RevokeCertificateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AdminCertificateRow> {
    return this.certificates.revoke(id, body, actorOf(user, req));
  }
}
