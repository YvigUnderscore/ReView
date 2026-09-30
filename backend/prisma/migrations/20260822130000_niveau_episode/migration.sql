-- ─────────────────────────────────────────────────────────────────────────────
-- Niveau Épisode, activable par projet (vague 4)
-- ─────────────────────────────────────────────────────────────────────────────
-- ReView ne connaissait que Projet → Séquence → Plan. La série — le plus gros volume du
-- secteur, 100 à 300 plans par épisode — suppose un cran au-dessus de la séquence.
--
-- Le niveau est FACULTATIF et DÉSACTIVÉ PAR DÉFAUT (`Project.episodesEnabled`). Un projet
-- de long-métrage ne doit rien voir changer : c'est pourquoi `Sequence.episodeId` est
-- nullable et le restera. Une séquence sans épisode est un état normal, pas un défaut de
-- données — aucune contrainte ne l'interdit, aucun écran ne la signale.
--
-- `ON DELETE SET NULL` sur `Sequence.episodeId`, jamais CASCADE : purger un épisode ne
-- doit pas emporter ses séquences, et derrière elles les plans, les versions et les
-- commentaires. La purge d'un épisode détache, elle ne détruit pas.
--
-- Le statut d'un épisode pointe le même référentiel que celui d'une séquence
-- (`PipelineStatus`, portée « sequence ») : ShotGrid sert la même liste de valeurs aux
-- deux entités, et un cinquième périmètre aurait dupliqué tous les écrans de réglage.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "episodesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "episodeId" INTEGER;

-- CreateTable
CREATE TABLE "Episode" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "thumbnailKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipelineStatusId" INTEGER,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Episode_projectId_code_key" ON "Episode"("projectId", "code");

-- CreateIndex
CREATE INDEX "Episode_projectId_deletedAt_order_code_idx" ON "Episode"("projectId", "deletedAt", "order", "code");

-- CreateIndex
CREATE INDEX "Episode_pipelineStatusId_idx" ON "Episode"("pipelineStatusId");

-- CreateIndex
CREATE INDEX "Sequence_episodeId_deletedAt_order_code_idx" ON "Sequence"("episodeId", "deletedAt", "order", "code");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_pipelineStatusId_fkey" FOREIGN KEY ("pipelineStatusId") REFERENCES "PipelineStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
