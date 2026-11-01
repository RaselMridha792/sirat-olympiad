-- Rounds and promotion (core C6a, CORE-PLAN §7): video criteria on rounds, the video time and the creating promotion
-- on entries, and promotion_runs (one per round and category). Generated from schema.prisma.

-- AlterTable
ALTER TABLE "round_entries" ADD COLUMN     "promotion_run_id" UUID,
ADD COLUMN     "video_submitted_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "criteria" JSONB;

-- CreateTable
CREATE TABLE "promotion_runs" (
    "id" UUID NOT NULL,
    "from_round_id" UUID NOT NULL,
    "to_round_id" UUID NOT NULL,
    "category" "Category" NOT NULL,
    "top_n" INTEGER NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_exam_id" UUID,
    "source_generation" INTEGER,
    "promoted_count" INTEGER NOT NULL,
    "eliminated_count" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotion_runs_to_round_id_idx" ON "promotion_runs"("to_round_id");

-- CreateIndex
CREATE INDEX "promotion_runs_source_exam_id_idx" ON "promotion_runs"("source_exam_id");

-- CreateIndex
CREATE INDEX "promotion_runs_created_by_id_idx" ON "promotion_runs"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_runs_from_round_id_category_key" ON "promotion_runs"("from_round_id", "category");

-- CreateIndex
CREATE INDEX "round_entries_promotion_run_id_idx" ON "round_entries"("promotion_run_id");

-- AddForeignKey
ALTER TABLE "round_entries" ADD CONSTRAINT "round_entries_promotion_run_id_fkey" FOREIGN KEY ("promotion_run_id") REFERENCES "promotion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_runs" ADD CONSTRAINT "promotion_runs_from_round_id_fkey" FOREIGN KEY ("from_round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_runs" ADD CONSTRAINT "promotion_runs_to_round_id_fkey" FOREIGN KEY ("to_round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_runs" ADD CONSTRAINT "promotion_runs_source_exam_id_fkey" FOREIGN KEY ("source_exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_runs" ADD CONSTRAINT "promotion_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
