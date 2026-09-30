-- Fiches markdown, assignation de personnes, image de département et masquage d'éléments.
--
-- Les index trigram de `MediaObject.originalName` et `Version.name` ne sont PAS repris ici :
-- ils sont posés à la main par la migration de recherche plein texte, et Prisma ne sait pas
-- les exprimer dans le schéma — il propose donc de les supprimer à chaque diff. Les laisser
-- tomber ferait repasser la recherche de médias en balayage séquentiel.

-- AlterTable
-- `updatedAt` prend une valeur par défaut : sans elle, l'ajout d'une colonne NOT NULL
-- échoue dès qu'un asset existe (et le premier studio venu en a des milliers).
ALTER TABLE "Asset" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "pipelineStatusId" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "imageKey" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT;

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT;

-- CreateTable
CREATE TABLE "VisibilityRule" (
    "id" SERIAL NOT NULL,
    "studioId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "entityType" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'exact',
    "pattern" TEXT NOT NULL,
    "ignoreCase" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityNote" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "episodeId" INTEGER,
    "sequenceId" INTEGER,
    "shotId" INTEGER,
    "assetId" INTEGER,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteTemplate" (
    "id" SERIAL NOT NULL,
    "studioId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EpisodeAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_SequenceAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ShotAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_AssetAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "VisibilityRule_studioId_projectId_enabled_idx" ON "VisibilityRule"("studioId", "projectId", "enabled");

-- CreateIndex
CREATE INDEX "VisibilityRule_projectId_idx" ON "VisibilityRule"("projectId");

-- CreateIndex
CREATE INDEX "VisibilityRule_createdById_idx" ON "VisibilityRule"("createdById");

-- CreateIndex
CREATE INDEX "EntityNote_projectId_idx" ON "EntityNote"("projectId");

-- CreateIndex
CREATE INDEX "EntityNote_episodeId_idx" ON "EntityNote"("episodeId");

-- CreateIndex
CREATE INDEX "EntityNote_sequenceId_idx" ON "EntityNote"("sequenceId");

-- CreateIndex
CREATE INDEX "EntityNote_shotId_idx" ON "EntityNote"("shotId");

-- CreateIndex
CREATE INDEX "EntityNote_assetId_idx" ON "EntityNote"("assetId");

-- CreateIndex
CREATE INDEX "EntityNote_updatedById_idx" ON "EntityNote"("updatedById");

-- CreateIndex
CREATE INDEX "NoteTemplate_studioId_projectId_scope_idx" ON "NoteTemplate"("studioId", "projectId", "scope");

-- CreateIndex
CREATE INDEX "NoteTemplate_projectId_idx" ON "NoteTemplate"("projectId");

-- CreateIndex
CREATE INDEX "NoteTemplate_createdById_idx" ON "NoteTemplate"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "_EpisodeAssignees_AB_unique" ON "_EpisodeAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_EpisodeAssignees_B_index" ON "_EpisodeAssignees"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_SequenceAssignees_AB_unique" ON "_SequenceAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_SequenceAssignees_B_index" ON "_SequenceAssignees"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ShotAssignees_AB_unique" ON "_ShotAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_ShotAssignees_B_index" ON "_ShotAssignees"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_AssetAssignees_AB_unique" ON "_AssetAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_AssetAssignees_B_index" ON "_AssetAssignees"("B");

-- CreateIndex
CREATE INDEX "Asset_pipelineStatusId_idx" ON "Asset"("pipelineStatusId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_pipelineStatusId_fkey" FOREIGN KEY ("pipelineStatusId") REFERENCES "PipelineStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityRule" ADD CONSTRAINT "VisibilityRule_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityRule" ADD CONSTRAINT "VisibilityRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityRule" ADD CONSTRAINT "VisibilityRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EpisodeAssignees" ADD CONSTRAINT "_EpisodeAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EpisodeAssignees" ADD CONSTRAINT "_EpisodeAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SequenceAssignees" ADD CONSTRAINT "_SequenceAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SequenceAssignees" ADD CONSTRAINT "_SequenceAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShotAssignees" ADD CONSTRAINT "_ShotAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Shot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShotAssignees" ADD CONSTRAINT "_ShotAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetAssignees" ADD CONSTRAINT "_AssetAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetAssignees" ADD CONSTRAINT "_AssetAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Garde-fous que le schéma Prisma ne sait pas exprimer
-- ─────────────────────────────────────────────────────────────────────────────

-- Une fiche vise exactement UNE entité. Sans ce CHECK, une note rattachée à rien — ou à
-- deux entités — n'apparaîtrait dans aucun écran (tous filtrés par une seule colonne)
-- sans qu'aucune erreur ne le signale. Même raison que `Task_parent_xor`.
ALTER TABLE "EntityNote" ADD CONSTRAINT "EntityNote_target_xor" CHECK (
  (("episodeId" IS NOT NULL)::int + ("sequenceId" IS NOT NULL)::int
   + ("shotId" IS NOT NULL)::int + ("assetId" IS NOT NULL)::int) = 1
);

-- Une seule fiche par entité : deux fiches sur le même plan feraient diverger deux briefs
-- que personne ne saurait départager. Index partiels, les NULL étant distincts en SQL.
CREATE UNIQUE INDEX "EntityNote_episode_unique" ON "EntityNote"("episodeId") WHERE "episodeId" IS NOT NULL;
CREATE UNIQUE INDEX "EntityNote_sequence_unique" ON "EntityNote"("sequenceId") WHERE "sequenceId" IS NOT NULL;
CREATE UNIQUE INDEX "EntityNote_shot_unique" ON "EntityNote"("shotId") WHERE "shotId" IS NOT NULL;
CREATE UNIQUE INDEX "EntityNote_asset_unique" ON "EntityNote"("assetId") WHERE "assetId" IS NOT NULL;

-- Périmètres admis, écrits en toutes lettres plutôt que laissés au bon vouloir de
-- l'appelant : une règle de type inconnu ne masquerait rien tout en paraissant active.
ALTER TABLE "VisibilityRule" ADD CONSTRAINT "VisibilityRule_entityType_check"
  CHECK ("entityType" IN ('all', 'episode', 'sequence', 'shot', 'asset'));
ALTER TABLE "VisibilityRule" ADD CONSTRAINT "VisibilityRule_matchType_check"
  CHECK ("matchType" IN ('exact', 'prefix', 'contains', 'regex'));
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_scope_check"
  CHECK ("scope" IN ('all', 'episode', 'sequence', 'shot', 'asset'));

-- Un nom de modèle est unique dans son périmètre : deux « Brief de plan » dans la même
-- liste ne se distinguent pas au moment de choisir.
CREATE UNIQUE INDEX "NoteTemplate_studio_name_unique" ON "NoteTemplate"("studioId", "scope", "name")
  WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX "NoteTemplate_project_name_unique" ON "NoteTemplate"("projectId", "scope", "name")
  WHERE "projectId" IS NOT NULL;

-- Listes filtrées « sans les éléments masqués » : la colonne suit le filtre de corbeille
-- dans les index existants, mais ceux-ci ne la portent pas. Un index partiel sur les seuls
-- éléments masqués suffit — ils sont rares, et c'est eux qu'on soustrait.
CREATE INDEX "Shot_hidden_idx" ON "Shot"("projectId") WHERE "hiddenAt" IS NOT NULL;
CREATE INDEX "Sequence_hidden_idx" ON "Sequence"("projectId") WHERE "hiddenAt" IS NOT NULL;
CREATE INDEX "Asset_hidden_idx" ON "Asset"("projectId") WHERE "hiddenAt" IS NOT NULL;
CREATE INDEX "Episode_hidden_idx" ON "Episode"("projectId") WHERE "hiddenAt" IS NOT NULL;
