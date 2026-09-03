/*
  Warnings:

  - The values [VIDEO] on the enum `MediaType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `sort_order` on the `project_media` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `project_media` table. All the data in the column will be lost.
  - Added the required column `display_order` to the `project_media` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterEnum
BEGIN;
CREATE TYPE "MediaType_new" AS ENUM ('IMAGE', 'PDF');
ALTER TABLE "project_media" ALTER COLUMN "type" TYPE "MediaType_new" USING ("type"::text::"MediaType_new");
ALTER TYPE "MediaType" RENAME TO "MediaType_old";
ALTER TYPE "MediaType_new" RENAME TO "MediaType";
DROP TYPE "public"."MediaType_old";
COMMIT;

-- DropIndex
DROP INDEX "project_media_project_id_scope_sort_order_idx";

-- AlterTable
ALTER TABLE "project_media" DROP COLUMN "sort_order",
DROP COLUMN "url",
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "display_order" INTEGER NOT NULL,
ADD COLUMN     "status" "MediaStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "project_media_project_id_scope_display_order_idx" ON "project_media"("project_id", "scope", "display_order");
