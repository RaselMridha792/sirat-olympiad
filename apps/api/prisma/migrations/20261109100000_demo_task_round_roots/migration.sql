-- AlterTable
ALTER TABLE "admin_tasks" ADD COLUMN     "demo_batch_id" UUID;

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "demo_batch_id" UUID;

-- CreateIndex
CREATE INDEX "admin_tasks_demo_batch_id_idx" ON "admin_tasks"("demo_batch_id");

-- CreateIndex
CREATE INDEX "rounds_demo_batch_id_idx" ON "rounds"("demo_batch_id");

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_demo_batch_id_fkey" FOREIGN KEY ("demo_batch_id") REFERENCES "demo_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

