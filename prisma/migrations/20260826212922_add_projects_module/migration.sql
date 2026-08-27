-- CreateEnum
CREATE TYPE "MediaScope" AS ENUM ('PORTFOLIO', 'PUBLICATION');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'PDF');

-- CreateEnum
CREATE TYPE "PublicationType" AS ENUM ('SALE', 'LINK', 'DOI');

-- CreateTable
CREATE TABLE "production_stages" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "client_label" TEXT NOT NULL,
    "client_description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "clickup_status_match" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "public_code" TEXT NOT NULL,
    "clickup_list_id" TEXT,
    "start_date" DATE,
    "estimated_total_days" INTEGER,
    "current_stage_id" TEXT,
    "estimated_end_date" DATE,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_media" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "scope" "MediaScope" NOT NULL,
    "type" "MediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "alt" TEXT,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_portfolios" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cover_url" TEXT,
    "cover_storage_key" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "client" TEXT,
    "issue_year" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cover_url" TEXT,
    "cover_storage_key" TEXT,
    "type" "PublicationType" NOT NULL,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edition_number" TEXT,
    "format" TEXT,
    "collection" TEXT,
    "measures" TEXT,
    "presentation" TEXT,
    "audience" TEXT,
    "language" TEXT,
    "isbn" TEXT,
    "sku" TEXT,
    "price" DECIMAL(10,2),
    "currency" TEXT DEFAULT 'MXN',
    "external_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_sections" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "pdf_url" TEXT NOT NULL,
    "pdf_storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "portfolio_max_items" INTEGER NOT NULL DEFAULT 10,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_stages_key_key" ON "production_stages"("key");

-- CreateIndex
CREATE UNIQUE INDEX "productions_project_id_key" ON "productions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "productions_public_code_key" ON "productions"("public_code");

-- CreateIndex
CREATE INDEX "project_media_project_id_scope_sort_order_idx" ON "project_media"("project_id", "scope", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "project_portfolios_project_id_key" ON "project_portfolios"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_portfolios_slug_key" ON "project_portfolios"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "publications_project_id_key" ON "publications"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_slug_key" ON "publications"("slug");

-- CreateIndex
CREATE INDEX "publication_sections_publication_id_sort_order_idx" ON "publication_sections"("publication_id", "sort_order");

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_portfolios" ADD CONSTRAINT "project_portfolios_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_sections" ADD CONSTRAINT "publication_sections_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
