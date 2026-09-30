-- Assignation de review (Phase 49) : qui doit regarder une version.
--
-- Une table de liaison, de la même forme que `_ShotAssignees` — l'assignation a un seul
-- vocabulaire dans toute l'application, et la décision de review (`ReviewDecision`) reste
-- ce qu'elle était : un acte de supervision, distinct de « c'est à toi de la regarder ».
--
-- Les index trigram de `MediaObject.originalName` et `Version.name` que `migrate dev`
-- propose de supprimer ici ne sont PAS repris : ils sont posés à la main par la migration
-- de recherche plein texte, Prisma ne sait pas les exprimer dans le schéma, et les laisser
-- tomber ferait repasser la recherche de médias en balayage séquentiel. Ils figurent à ce
-- titre dans `scripts/prisma-drift-allowed.json`.

-- CreateTable
CREATE TABLE "_VersionReviewers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_VersionReviewers_AB_unique" ON "_VersionReviewers"("A", "B");

-- CreateIndex
CREATE INDEX "_VersionReviewers_B_index" ON "_VersionReviewers"("B");

-- AddForeignKey
ALTER TABLE "_VersionReviewers" ADD CONSTRAINT "_VersionReviewers_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VersionReviewers" ADD CONSTRAINT "_VersionReviewers_B_fkey" FOREIGN KEY ("B") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
