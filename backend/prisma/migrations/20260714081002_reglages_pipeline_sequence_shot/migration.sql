-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';
