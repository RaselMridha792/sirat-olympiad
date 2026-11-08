-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "demo_batch_id" UUID;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "demo_batch_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "demo_batch_id" UUID;

-- CreateTable
CREATE TABLE "demo_batches" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_records" (
    "table_name" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,

    CONSTRAINT "demo_records_pkey" PRIMARY KEY ("table_name","row_id")
);

-- CreateIndex
CREATE INDEX "demo_batches_created_by_id_idx" ON "demo_batches"("created_by_id");

-- CreateIndex
CREATE INDEX "demo_records_batch_id_idx" ON "demo_records"("batch_id");

-- CreateIndex
CREATE INDEX "announcements_demo_batch_id_idx" ON "announcements"("demo_batch_id");

-- CreateIndex
CREATE INDEX "exams_demo_batch_id_idx" ON "exams"("demo_batch_id");

-- CreateIndex
CREATE INDEX "users_demo_batch_id_idx" ON "users"("demo_batch_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_batches" ADD CONSTRAINT "demo_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

