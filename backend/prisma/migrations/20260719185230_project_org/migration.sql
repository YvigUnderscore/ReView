-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "storageQuota" BIGINT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]';
