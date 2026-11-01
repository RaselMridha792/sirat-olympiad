-- Ambassador tasks (core C5b-2): archived tasks, the proof and its time, the reject note, and the review queue index.
-- Generated from schema.prisma.

-- AlterTable
ALTER TABLE "admin_tasks" ADD COLUMN     "archived_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "task_assignments" ADD COLUMN     "proof_text" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "task_assignments_status_submitted_at_idx" ON "task_assignments"("status", "submitted_at");

