import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Security audit trail. The admin read endpoint (GET /admin/audit) comes with the admin module. */
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
