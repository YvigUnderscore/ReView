-- Liaisons N-N : un Asset peut être rattaché à plusieurs Shots et/ou Séquences,
-- et inversement. Tables de jointure implicites Prisma.

-- CreateTable
CREATE TABLE "_AssetShots" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_AssetSequences" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AssetShots_AB_unique" ON "_AssetShots"("A", "B");
CREATE INDEX "_AssetShots_B_index" ON "_AssetShots"("B");
CREATE UNIQUE INDEX "_AssetSequences_AB_unique" ON "_AssetSequences"("A", "B");
CREATE INDEX "_AssetSequences_B_index" ON "_AssetSequences"("B");

-- AddForeignKey
ALTER TABLE "_AssetShots" ADD CONSTRAINT "_AssetShots_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AssetShots" ADD CONSTRAINT "_AssetShots_B_fkey" FOREIGN KEY ("B") REFERENCES "Shot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AssetSequences" ADD CONSTRAINT "_AssetSequences_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AssetSequences" ADD CONSTRAINT "_AssetSequences_B_fkey" FOREIGN KEY ("B") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
