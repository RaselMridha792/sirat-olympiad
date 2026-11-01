-- Jury (core C6b, CORE-PLAN §7): which judge scores which categories of a video round. Generated from
-- schema.prisma.

-- CreateTable
CREATE TABLE "jury_assignments" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "judge_id" UUID NOT NULL,
    "category" "Category" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jury_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jury_assignments_judge_id_idx" ON "jury_assignments"("judge_id");

-- CreateIndex
CREATE INDEX "jury_assignments_created_by_id_idx" ON "jury_assignments"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "jury_assignments_round_id_judge_id_category_key" ON "jury_assignments"("round_id", "judge_id", "category");

-- AddForeignKey
ALTER TABLE "jury_assignments" ADD CONSTRAINT "jury_assignments_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jury_assignments" ADD CONSTRAINT "jury_assignments_judge_id_fkey" FOREIGN KEY ("judge_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jury_assignments" ADD CONSTRAINT "jury_assignments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
