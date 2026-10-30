import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';

/** One security event (RULEBOOK §5: failed logins, password changes, token reuse...). Never a password or token. */
export interface AuditEvent {
  action: string; // dotted, e.g. auth.refresh_reuse
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  meta?: Prisma.InputJsonValue;
}

/** Appends to `audit_logs` (append-only in the database). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: a failed audit write is logged (action and error class only) and the request goes on. */
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: event.action,
          actorId: event.actorId ?? null,
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          ip: event.ip ?? null,
          meta: event.meta,
        },
      });
    } catch (e) {
      this.logger.error({ msg: 'audit write failed', action: event.action, ...errorLogFields(e) });
    }
  }
}
