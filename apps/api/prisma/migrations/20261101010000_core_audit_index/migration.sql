-- The admin audit-log viewer (core; lead 2026-11-01): newest first with keyset paging on (created_at, id), and the
-- actor filter. Generated from schema.prisma (AuditLog @@index). The append-only triggers are unchanged.

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

