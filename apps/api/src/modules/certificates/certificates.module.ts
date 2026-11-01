import { Module } from '@nestjs/common';
import { CertificateIssuer } from './certificate-issuer';
import {
  AdminCertificatesController,
  CertificateCheckController,
  MyCertificatesController,
} from './certificates.controller';
import { CertificatesQueue } from './certificates.queue';
import { CertificatesService } from './certificates.service';

/**
 * Certificates (core C6c-1): the admin's issue run (a queue job: certificates.worker.ts in the worker), the list and
 * the revoke; the student's own list; the public check (name and award only). The PDF follows in C6c-2.
 * Plan: docs/plans/CORE-PLAN.md section 7; contract: docs/06-API.md "Certificates".
 */
@Module({
  controllers: [MyCertificatesController, CertificateCheckController, AdminCertificatesController],
  providers: [CertificatesService, CertificateIssuer, CertificatesQueue],
})
export class CertificatesModule {}
