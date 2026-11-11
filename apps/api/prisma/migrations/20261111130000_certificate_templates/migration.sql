-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL,
    "lineage_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_bn" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "body_bn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_template_signatories" (
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_bn" TEXT NOT NULL,
    "image_id" UUID,

    CONSTRAINT "certificate_template_signatories_pkey" PRIMARY KEY ("template_id","position")
);

-- CreateTable
CREATE TABLE "certificate_images" (
    "id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificate_templates_created_by_id_idx" ON "certificate_templates"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_templates_lineage_id_version_key" ON "certificate_templates"("lineage_id", "version");

-- CreateIndex
CREATE INDEX "certificate_template_signatories_image_id_idx" ON "certificate_template_signatories"("image_id");

-- CreateIndex
CREATE INDEX "certificate_images_uploaded_by_id_idx" ON "certificate_images"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "certificates_template_id_idx" ON "certificates"("template_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_template_signatories" ADD CONSTRAINT "certificate_template_signatories_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_template_signatories" ADD CONSTRAINT "certificate_template_signatories_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "certificate_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_images" ADD CONSTRAINT "certificate_images_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── C1 (DECISIONS "Certificate templates"): the rules the API checks, kept by the database too ──────────────────

-- Plain text with {name}, {round} and {date} only: no other brace, no `<` or `>` (no HTML ever reaches the PDF).
-- The lengths are the coarse bound; the API checks the worst case after filling (CERT_TEMPLATE_LIMITS).
ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "certificate_templates_type_check" CHECK ("type" IN ('participation', 'promotion', 'winner')),
  ADD CONSTRAINT "certificate_templates_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "certificate_templates_title_check" CHECK (
    char_length(btrim("title_en")) BETWEEN 1 AND 120 AND char_length(btrim("title_bn")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "certificate_templates_body_check" CHECK (
    char_length(btrim("body_en")) BETWEEN 1 AND 600 AND char_length(btrim("body_bn")) BETWEEN 1 AND 600),
  ADD CONSTRAINT "certificate_templates_text_check" CHECK (
    regexp_replace("title_en" || "title_bn" || "body_en" || "body_bn", '\{(name|round|date)\}', '', 'g') !~ '[{}<>]');

-- One active version per type: the version a certificate gets at issue.
CREATE UNIQUE INDEX "certificate_templates_one_active" ON "certificate_templates" ("type") WHERE "active";

ALTER TABLE "certificate_template_signatories"
  ADD CONSTRAINT "certificate_template_signatories_position_check" CHECK ("position" BETWEEN 1 AND 3),
  ADD CONSTRAINT "certificate_template_signatories_text_check" CHECK (
    char_length(btrim("name_en")) BETWEEN 1 AND 80 AND char_length(btrim("name_bn")) BETWEEN 1 AND 80
    AND char_length(btrim("title_en")) BETWEEN 1 AND 80 AND char_length(btrim("title_bn")) BETWEEN 1 AND 80
    AND "name_en" || "name_bn" || "title_en" || "title_bn" !~ '[{}<>]');

-- PNG or JPEG, at most 200 KB and 2000×1000 px (the API reads the header; this is the backstop).
ALTER TABLE "certificate_images"
  ADD CONSTRAINT "certificate_images_type_check" CHECK ("content_type" IN ('image/png', 'image/jpeg')),
  ADD CONSTRAINT "certificate_images_size_check" CHECK (
    octet_length("data") BETWEEN 1 AND 204800 AND "byte_size" = octet_length("data")),
  ADD CONSTRAINT "certificate_images_pixels_check" CHECK (
    "width" BETWEEN 10 AND 2000 AND "height" BETWEEN 10 AND 1000),
  ADD CONSTRAINT "certificate_images_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- A version never changes once made (certificates keep it): only `active` may move. Never deleted.
CREATE FUNCTION "certificate_templates_frozen"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'certificate_templates: a version is never deleted';
  END IF;
  IF (NEW."id", NEW."lineage_id", NEW."version", NEW."type", NEW."title_en", NEW."title_bn", NEW."body_en",
      NEW."body_bn", NEW."created_by_id", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."lineage_id", OLD."version", OLD."type", OLD."title_en", OLD."title_bn", OLD."body_en",
      OLD."body_bn", OLD."created_by_id", OLD."created_at") THEN
    RAISE EXCEPTION 'certificate_templates: a version never changes (make a new version); only active may change';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "certificate_templates_frozen" BEFORE UPDATE OR DELETE ON "certificate_templates"
  FOR EACH ROW EXECUTE FUNCTION "certificate_templates_frozen"();

-- A version's signatories are part of it: append-only (runtime-role.ts then keeps sirat_app to SELECT and INSERT).
CREATE FUNCTION "certificate_template_signatories_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'certificate_template_signatories is append-only: % is not allowed', TG_OP;
END
$$;
CREATE TRIGGER "certificate_template_signatories_append_only"
  BEFORE UPDATE OR DELETE ON "certificate_template_signatories"
  FOR EACH ROW EXECUTE FUNCTION "certificate_template_signatories_append_only"();

-- An image never changes; it may be deleted only while unused (the signatories' FK is RESTRICT).
CREATE FUNCTION "certificate_images_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'certificate_images: an image never changes (upload a new one)';
END
$$;
CREATE TRIGGER "certificate_images_immutable" BEFORE UPDATE ON "certificate_images"
  FOR EACH ROW EXECUTE FUNCTION "certificate_images_immutable"();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirat_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "certificate_template_signatories" FROM sirat_app;
  END IF;
END
$$;
