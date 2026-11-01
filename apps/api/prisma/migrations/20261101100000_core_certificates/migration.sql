-- Certificates (core C6c, CORE-PLAN §7): the round, the name copied at issue, the revoke fields, one per (user, type,
-- round). Generated from schema.prisma (prisma migrate diff). The NOT NULL columns need an empty certificates table,
-- which it is: nothing wrote to it before C6c.

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "name_on_certificate" TEXT NOT NULL,
ADD COLUMN     "revoke_reason" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMPTZ,
ADD COLUMN     "revoked_by_id" UUID,
ADD COLUMN     "round_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "certificates_round_id_type_idx" ON "certificates"("round_id", "type");

-- CreateIndex
CREATE INDEX "certificates_revoked_by_id_idx" ON "certificates"("revoked_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_user_id_type_round_id_key" ON "certificates"("user_id", "type", "round_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

