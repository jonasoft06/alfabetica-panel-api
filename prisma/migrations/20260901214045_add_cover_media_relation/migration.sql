/*
  Warnings:

  - You are about to drop the column `cover_storage_key` on the `project_portfolios` table. All the data in the column will be lost.
  - You are about to drop the column `cover_url` on the `project_portfolios` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[cover_media_id]` on the table `project_portfolios` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "project_portfolios" DROP COLUMN "cover_storage_key",
DROP COLUMN "cover_url",
ADD COLUMN     "cover_media_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "project_portfolios_cover_media_id_key" ON "project_portfolios"("cover_media_id");

-- AddForeignKey
ALTER TABLE "project_portfolios" ADD CONSTRAINT "project_portfolios_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "project_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
