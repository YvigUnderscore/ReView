-- La consigne donnée au ReViewer : « regarde le raccord au 1042, le reste est validé ».
--
-- L'assignation de review existait déjà (`_VersionReviewers`, migration précédente) mais
-- sous la forme d'une table de LIAISON IMPLICITE, qui par construction ne peut porter
-- aucune colonne. Porter la consigne demande donc un modèle à part entière — c'est la
-- seule raison de ce remplacement, et les lignes déjà posées sont reprises telles quelles :
-- personne ne perd une assignation faite hier.
--
-- Les index trigram de `MediaObject.originalName` et `Version.name` que `migrate dev`
-- propose de supprimer ici ne sont PAS repris : ils sont posés à la main par la migration
-- de recherche plein texte, Prisma ne sait pas les exprimer dans le schéma, et les laisser
-- tomber ferait repasser la recherche de médias en balayage séquentiel. Ils figurent à ce
-- titre dans `scripts/prisma-drift-allowed.json`.

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "note" TEXT,
    "assignedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewAssignment_reviewerId_createdAt_idx" ON "ReviewAssignment"("reviewerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewAssignment_assignedById_idx" ON "ReviewAssignment"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAssignment_versionId_reviewerId_key" ON "ReviewAssignment"("versionId", "reviewerId");

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise des assignations existantes. `_VersionReviewers` suit la convention Prisma des
-- liaisons implicites : « A » est le côté User (le modèle dont le nom vient en premier dans
-- l'ordre alphabétique), « B » le côté Version. Sans consigne ni auteur — la table n'en
-- portait pas, et inventer un auteur serait pire que de n'en pas avoir.
INSERT INTO "ReviewAssignment" ("versionId", "reviewerId", "updatedAt")
SELECT "B", "A", CURRENT_TIMESTAMP FROM "_VersionReviewers";

-- DropTable
DROP TABLE "_VersionReviewers";
