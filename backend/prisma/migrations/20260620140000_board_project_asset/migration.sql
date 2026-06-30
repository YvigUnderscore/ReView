-- Board mood/reference (9.B) : passe d'un board par version à un board par Projet / par Asset.
-- Les boards par version existants sont supprimés (pivot mood/reference, greenfield assumé).
DELETE FROM "Board";

-- DropForeignKey
ALTER TABLE "Board" DROP CONSTRAINT "Board_versionId_fkey";

-- DropIndex
DROP INDEX "Board_versionId_key";

-- AlterTable
ALTER TABLE "Board" DROP COLUMN "versionId",
  ADD COLUMN "projectId" INTEGER,
  ADD COLUMN "assetId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Board_projectId_key" ON "Board"("projectId");
CREATE UNIQUE INDEX "Board_assetId_key" ON "Board"("assetId");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Board" ADD CONSTRAINT "Board_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
