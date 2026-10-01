-- DropIndex
DROP INDEX "publication_sections_publication_id_sort_order_idx";

-- AlterTable
ALTER TABLE "publication_sections" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "publication_sections_publication_id_sort_order_key" ON "publication_sections"("publication_id", "sort_order");

