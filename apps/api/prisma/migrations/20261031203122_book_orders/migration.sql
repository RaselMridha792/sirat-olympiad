-- CreateEnum
CREATE TYPE "BookOrderStatus" AS ENUM ('confirmed', 'shipped');

-- CreateTable
CREATE TABLE "book_images" (
    "id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "status" "BookOrderStatus" NOT NULL DEFAULT 'confirmed',
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "upazila" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "note" TEXT,
    "book_title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipped_at" TIMESTAMPTZ,
    "shipped_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_images_sha256_key" ON "book_images"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "book_orders_user_id_key" ON "book_orders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_orders_registration_id_key" ON "book_orders"("registration_id");

-- CreateIndex
CREATE INDEX "book_orders_status_created_at_idx" ON "book_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "book_orders_district_idx" ON "book_orders"("district");

-- CreateIndex
CREATE INDEX "book_orders_recipient_phone_idx" ON "book_orders"("recipient_phone");

-- CreateIndex
CREATE UNIQUE INDEX "book_orders_registration_id_user_id_key" ON "book_orders"("registration_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_id_user_id_key" ON "registrations"("id", "user_id");

-- AddForeignKey
ALTER TABLE "book_images" ADD CONSTRAINT "book_images_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_orders" ADD CONSTRAINT "book_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_orders" ADD CONSTRAINT "book_orders_registration_id_user_id_fkey" FOREIGN KEY ("registration_id", "user_id") REFERENCES "registrations"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_orders" ADD CONSTRAINT "book_orders_shipped_by_fkey" FOREIGN KEY ("shipped_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

