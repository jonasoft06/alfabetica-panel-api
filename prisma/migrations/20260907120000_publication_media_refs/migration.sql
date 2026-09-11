/*
  Warnings:

  - You are about to drop the column `pdf_storage_key` on the `publication_sections` table. All the data in the column will be lost.
  - You are about to drop the column `pdf_url` on the `publication_sections` table. All the data in the column will be lost.
  - You are about to drop the column `cover_storage_key` on the `publications` table. All the data in the column will be lost.
  - You are about to drop the column `cover_url` on the `publications` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[pdf_media_id]` on the table `publication_sections` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[cover_media_id]` on the table `publications` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `pdf_media_id` to the `publication_sections` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "publication_sections" DROP COLUMN "pdf_storage_key",
DROP COLUMN "pdf_url",
ADD COLUMN     "pdf_media_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "publications" DROP COLUMN "cover_storage_key",
DROP COLUMN "cover_url",
ADD COLUMN     "compare_at_price" DECIMAL(10,2),
ADD COLUMN     "cover_media_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "publication_sections_pdf_media_id_key" ON "publication_sections"("pdf_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_cover_media_id_key" ON "publications"("cover_media_id");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "project_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_sections" ADD CONSTRAINT "publication_sections_pdf_media_id_fkey" FOREIGN KEY ("pdf_media_id") REFERENCES "project_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;