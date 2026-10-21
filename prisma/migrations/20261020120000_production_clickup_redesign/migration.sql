-- CreateEnum
CREATE TYPE "BookType" AS ENUM ('ACADEMIC', 'TEXTBOOK');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('NOT_LINKED', 'IN_PRODUCTION', 'FINISHED');

-- DropForeignKey
ALTER TABLE "productions" DROP CONSTRAINT "productions_current_stage_id_fkey";

-- AlterTable
ALTER TABLE "productions" DROP COLUMN "current_stage_id",
DROP COLUMN "estimated_total_days",
DROP COLUMN "start_date",
ADD COLUMN     "author_name" TEXT,
ADD COLUMN     "book_type" "BookType",
ADD COLUMN     "current_phase_id" TEXT,
ADD COLUMN     "current_stage_due_date" DATE,
ADD COLUMN     "current_stage_name" TEXT,
ADD COLUMN     "status" "ProductionStatus" NOT NULL DEFAULT 'NOT_LINKED',
ADD COLUMN     "updated_by_id" TEXT;

-- DropTable
DROP TABLE "production_stages";

-- CreateTable
CREATE TABLE "production_phases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "production_phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_phases_code_key" ON "production_phases"("code");

-- CreateIndex
CREATE UNIQUE INDEX "productions_clickup_list_id_key" ON "productions"("clickup_list_id");

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_current_phase_id_fkey" FOREIGN KEY ("current_phase_id") REFERENCES "production_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

