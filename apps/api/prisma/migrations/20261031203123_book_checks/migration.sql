-- Free book rules that Prisma cannot express (docs/plans/PAYMENTS-PLAN.md section 16.2). Kept apart from the generated
-- *_book_orders migration, like the payments checks. Names are explicit so integration tests can assert them.
--
-- The district list below is BD_DISTRICTS from packages/shared/src/registration.ts, the same list the registration
-- form offers; src/modules/book/districts-check.spec.ts fails if the two ever differ.

-- ───────────── book_images ─────────────
-- What the upload code already guarantees (plan 16.5), checked once more by the database.
ALTER TABLE "book_images"
  ADD CONSTRAINT "book_images_content_type_check" CHECK (
    "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  ADD CONSTRAINT "book_images_byte_size_check" CHECK (
    "byte_size" BETWEEN 1 AND 819200 AND octet_length("data") = "byte_size"
  ),
  ADD CONSTRAINT "book_images_dimensions_check" CHECK (
    "width" BETWEEN 100 AND 4000 AND "height" BETWEEN 100 AND 4000
  ),
  ADD CONSTRAINT "book_images_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- ───────────── book_orders ─────────────
ALTER TABLE "book_orders"
  ADD CONSTRAINT "book_orders_recipient_name_check" CHECK (
    char_length(btrim("recipient_name")) BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT "book_orders_recipient_phone_check" CHECK ("recipient_phone" ~ '^01[3-9][0-9]{8}$'),
  ADD CONSTRAINT "book_orders_district_check" CHECK ("district" IN (
    'Dhaka', 'Faridpur', 'Gazipur', 'Gopalganj', 'Kishoreganj', 'Madaripur',
    'Manikganj', 'Munshiganj', 'Narayanganj', 'Narsingdi', 'Rajbari', 'Shariatpur',
    'Tangail', 'Bandarban', 'Brahmanbaria', 'Chandpur', 'Chattogram', 'Cox''s Bazar',
    'Cumilla', 'Feni', 'Khagrachhari', 'Lakshmipur', 'Noakhali', 'Rangamati',
    'Bogura', 'Chapai Nawabganj', 'Joypurhat', 'Naogaon', 'Natore', 'Pabna',
    'Rajshahi', 'Sirajganj', 'Bagerhat', 'Chuadanga', 'Jashore', 'Jhenaidah',
    'Khulna', 'Kushtia', 'Magura', 'Meherpur', 'Narail', 'Satkhira',
    'Barguna', 'Barishal', 'Bhola', 'Jhalokathi', 'Patuakhali', 'Pirojpur',
    'Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet', 'Dinajpur', 'Gaibandha',
    'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Rangpur', 'Thakurgaon',
    'Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'
  )),
  ADD CONSTRAINT "book_orders_upazila_check" CHECK (char_length(btrim("upazila")) BETWEEN 2 AND 100),
  ADD CONSTRAINT "book_orders_address_line_check" CHECK (
    char_length(btrim("address_line")) BETWEEN 5 AND 300
  ),
  ADD CONSTRAINT "book_orders_note_check" CHECK ("note" IS NULL OR char_length("note") <= 300),
  ADD CONSTRAINT "book_orders_book_title_check" CHECK (char_length(btrim("book_title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "book_orders_version_check" CHECK ("version" >= 1),
  -- shipped exactly when both shipped_at and shipped_by are set; a confirmed order has neither.
  ADD CONSTRAINT "book_orders_shipped_check" CHECK (
    ("status"::text = 'shipped' AND "shipped_at" IS NOT NULL AND "shipped_by" IS NOT NULL)
    OR ("status"::text <> 'shipped' AND "shipped_at" IS NULL AND "shipped_by" IS NULL)
  );

-- A new order is always `confirmed`. Once `shipped` (owner B5), the address, the recipient and the title snapshot
-- cannot change and the status never goes back; the API answers 409 before it gets here.
CREATE FUNCTION book_orders_locked_after_shipping() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text <> 'confirmed' THEN
      RAISE EXCEPTION 'book_orders: a new order must start as confirmed (got %)', NEW."status";
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status"::text = 'shipped' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."registration_id" IS DISTINCT FROM OLD."registration_id"
    OR NEW."recipient_name" IS DISTINCT FROM OLD."recipient_name"
    OR NEW."recipient_phone" IS DISTINCT FROM OLD."recipient_phone"
    OR NEW."district" IS DISTINCT FROM OLD."district"
    OR NEW."upazila" IS DISTINCT FROM OLD."upazila"
    OR NEW."address_line" IS DISTINCT FROM OLD."address_line"
    OR NEW."note" IS DISTINCT FROM OLD."note"
    OR NEW."book_title" IS DISTINCT FROM OLD."book_title"
    OR NEW."shipped_at" IS DISTINCT FROM OLD."shipped_at"
    OR NEW."shipped_by" IS DISTINCT FROM OLD."shipped_by"
  ) THEN
    RAISE EXCEPTION 'book_orders: a shipped order cannot change';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER book_orders_locked_after_shipping
  BEFORE INSERT OR UPDATE ON "book_orders"
  FOR EACH ROW EXECUTE FUNCTION book_orders_locked_after_shipping();

-- ───────────── settings ─────────────
-- The book's title is 1-200 characters; the cover is null or the id of a stored image (no foreign key from a JSON
-- value: the admin endpoint checks that it exists). CASE fixes the evaluation order, as for the fee.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_book_title_check" CHECK (
    "key" <> 'book_title'
    OR CASE
      WHEN jsonb_typeof("value") = 'string'
        THEN char_length(btrim("value" #>> '{}')) BETWEEN 1 AND 200
      ELSE false
    END
  ),
  ADD CONSTRAINT "settings_book_cover_check" CHECK (
    "key" <> 'book_cover_image_id'
    OR CASE
      WHEN jsonb_typeof("value") = 'null' THEN true
      WHEN jsonb_typeof("value") = 'string'
        THEN ("value" #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ELSE false
    END
  );
