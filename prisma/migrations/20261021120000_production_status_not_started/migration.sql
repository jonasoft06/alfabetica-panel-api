-- Rename in place: rows keep their value (enum values are stored by internal
-- id), so every NOT_LINKED production reads as NOT_STARTED afterwards.
ALTER TYPE "ProductionStatus" RENAME VALUE 'NOT_LINKED' TO 'NOT_STARTED';

-- AlterTable
ALTER TABLE "productions" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
