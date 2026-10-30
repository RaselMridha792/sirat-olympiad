import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SecurityAlerts } from './security-alerts.service';

/** Security audit trail and alerts. The admin read endpoint (GET /admin/audit) comes with the admin module. */
@Module({ providers: [AuditService, SecurityAlerts], exports: [AuditService, SecurityAlerts] })
export class AuditModule {}
