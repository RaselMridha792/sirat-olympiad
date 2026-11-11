import { Module } from '@nestjs/common';
import {
  AdminCertificateImagesController,
  AdminCertificateIssueOneController,
  AdminCertificateTemplatesController,
} from './certificate-templates.controller';
import { CertificateTemplatesService } from './certificate-templates.service';

/**
 * Certificate templates, signature images and the single manual issue (C1, exam; DECISIONS "Certificate templates").
 * Core's certificates module issues in batches and renders the PDF (C2) from these tables.
 */
@Module({
  controllers: [
    AdminCertificateTemplatesController,
    AdminCertificateImagesController,
    AdminCertificateIssueOneController,
  ],
  providers: [CertificateTemplatesService],
})
export class CertificateTemplatesModule {}
