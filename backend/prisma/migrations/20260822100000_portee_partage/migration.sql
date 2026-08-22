-- ─────────────────────────────────────────────────────────────────────────────
-- Portée des liens de partage (vague 3 — manques fonctionnels)
-- ─────────────────────────────────────────────────────────────────────────────
-- Un `ShareLink` ne connaissait que son projet : la page publique listait TOUS les médias
-- publiés du projet, sans borne. Faire valider un plan par un client lui ouvrait donc le
-- film entier — séquences non montrées, essais, autres clients. La portée devient une
-- propriété du lien (projet, playlist, version, sélection de médias) et vaut pour toutes
-- les lectures qu'il autorise, pas seulement pour l'affichage de la liste.
--
-- La cible est en CASCADE, jamais en SET NULL : un lien qui survivrait à sa playlist
-- retomberait sur la portée « projet » et rouvrirait ce qu'il ne devait pas montrer.
-- La contrainte `ShareLink_scope_target` interdit d'ailleurs l'état intermédiaire.

-- CreateEnum
CREATE TYPE "ShareScope" AS ENUM ('PROJECT', 'PLAYLIST', 'VERSION', 'MEDIA');

-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "scope" "ShareScope" NOT NULL DEFAULT 'PROJECT',
ADD COLUMN     "playlistId" INTEGER,
ADD COLUMN     "versionId" INTEGER;

-- CreateTable
-- Table de jonction plutôt qu'un tableau d'entiers : la purge définitive d'un média doit
-- retirer le droit de le lire, pas laisser un identifiant orphelin dans une colonne.
CREATE TABLE "ShareLinkMedia" (
    "id" SERIAL NOT NULL,
    "shareLinkId" INTEGER NOT NULL,
    "mediaObjectId" INTEGER NOT NULL,

    CONSTRAINT "ShareLinkMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLinkMedia_shareLinkId_mediaObjectId_key" ON "ShareLinkMedia"("shareLinkId", "mediaObjectId");

-- CreateIndex
CREATE INDEX "ShareLinkMedia_mediaObjectId_idx" ON "ShareLinkMedia"("mediaObjectId");

-- CreateIndex
CREATE INDEX "ShareLink_playlistId_idx" ON "ShareLink"("playlistId");

-- CreateIndex
CREATE INDEX "ShareLink_versionId_idx" ON "ShareLink"("versionId");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkMedia" ADD CONSTRAINT "ShareLinkMedia_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkMedia" ADD CONSTRAINT "ShareLinkMedia_mediaObjectId_fkey" FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cohérence portée/cible. Prisma ne sait pas l'exprimer : sans elle, un lien `PLAYLIST`
-- sans playlist se lirait comme un lien de projet, c'est-à-dire comme un lien qui montre
-- tout. Les portées `PROJECT` et `MEDIA` n'ont pas de cible colonne (la sélection vit dans
-- `ShareLinkMedia`), on exige donc l'absence des deux.
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_scope_target" CHECK (
  ("scope" = 'PLAYLIST' AND "playlistId" IS NOT NULL AND "versionId" IS NULL)
  OR ("scope" = 'VERSION' AND "versionId" IS NOT NULL AND "playlistId" IS NULL)
  OR ("scope" IN ('PROJECT', 'MEDIA') AND "playlistId" IS NULL AND "versionId" IS NULL)
);
