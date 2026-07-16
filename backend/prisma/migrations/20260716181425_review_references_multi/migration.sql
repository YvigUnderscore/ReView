-- DropIndex
DROP INDEX "ReviewReference_mediaObjectId_key";

-- AlterTable
ALTER TABLE "ReviewReference" ALTER COLUMN "x" SET DEFAULT 1.05,
ALTER COLUMN "y" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "ReviewReference_mediaObjectId_idx" ON "ReviewReference"("mediaObjectId");
