-- AlterEnum
ALTER TYPE "SharePermission" ADD VALUE 'DECIDE';

-- NOTE : `prisma migrate dev` avait écrit ici deux DROP INDEX sur
-- `MediaObject_originalName_trgm_idx` et `Version_name_trgm_idx`. Ce sont des index GIN
-- trigrammes posés en SQL brut (migration 20260822120000) : Prisma ne sait pas les déclarer,
-- les prend donc pour une dérive, et « corrige » en les supprimant. Les laisser aurait retiré
-- en silence l'index de la recherche par fragment sur les noms de fichier et de version.
-- Retirés à la main ; `scripts/check-prisma-drift.mjs` est ce qui l'a vu.

-- AlterTable
ALTER TABLE "ReviewDecision" ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "shareLinkId" INTEGER;

-- CreateIndex
CREATE INDEX "ReviewDecision_shareLinkId_versionId_idx" ON "ReviewDecision"("shareLinkId", "versionId");

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
