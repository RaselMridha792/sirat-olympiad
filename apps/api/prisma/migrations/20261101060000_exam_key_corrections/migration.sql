-- E7b: answer-key corrections (docs/plans/EXAM-PLAN.md 4.1; DECISIONS "Answer-key correction"). The question rows stay
-- frozen; a correction is a new row, and the newest one's to_key is the key everywhere a key is read. Generated from
-- schema.prisma; the CHECKs, triggers and the REVOKE are in *_exam_key_corrections_checks.

-- CreateTable
CREATE TABLE "answer_key_corrections" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "from_key" TEXT NOT NULL,
    "to_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_key_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "answer_key_corrections_question_id_created_at_idx" ON "answer_key_corrections"("question_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "answer_key_corrections_exam_id_created_at_idx" ON "answer_key_corrections"("exam_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "answer_key_corrections" ADD CONSTRAINT "answer_key_corrections_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_key_corrections" ADD CONSTRAINT "answer_key_corrections_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_key_corrections" ADD CONSTRAINT "answer_key_corrections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

