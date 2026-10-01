-- AlterTable
ALTER TABLE "project_media" ADD COLUMN     "original_name" TEXT;

-- AlterTable
ALTER TABLE "publication_sections" ADD COLUMN     "description" TEXT,
ALTER COLUMN "pdf_media_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "publications" ADD COLUMN     "pages" INTEGER;

