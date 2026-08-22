-- ─────────────────────────────────────────────────────────────────────────────
-- Séquences d'images (vague 5)
-- ─────────────────────────────────────────────────────────────────────────────
-- Le livrable réel du VFX n'est pas un fichier mais mille : `plan.1001.exr` à
-- `plan.1200.exr`. ReView ne savait ingérer qu'un fichier isolé — le studio devait
-- pré-encoder hors de l'outil avant chaque review.
--
-- Une séquence est UN média. Le `MediaObject` porteur est de type VIDEO (c'est ainsi
-- qu'elle se review, comme un playblast), sa `storageKey` désigne le manifeste JSON écrit
-- à la finalisation, et les frames vivent sous le préfixe voisin `…/{mediaId}/frames/`.
-- Cette table porte ce que le manifeste seul ne permettrait pas de chercher.
--
-- `frameCount` peut être inférieur à `endFrame - startFrame + 1` : une numérotation à
-- trous est un fait de production (un rendu relancé sur quelques frames), pas une erreur.
-- Aucune contrainte ne l'interdit ; le worker renumérote localement à l'assemblage.
--
-- `framerate` est figé au dépôt à partir de l'héritage studio→projet→séquence→shot : le
-- master doit pouvoir être reconstruit à l'identique des années plus tard, y compris si le
-- réglage du projet change entre-temps.
--
-- Pas d'index sur `mediaObjectId` en plus de l'unicité : la relation est un-à-un, l'index
-- unique est déjà l'index de tête.

-- CreateTable
CREATE TABLE "ImageSequence" (
    "id" SERIAL NOT NULL,
    "mediaObjectId" INTEGER NOT NULL,
    "pattern" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "digits" INTEGER NOT NULL,
    "startFrame" INTEGER NOT NULL,
    "endFrame" INTEGER NOT NULL,
    "frameCount" INTEGER NOT NULL,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "framerate" DOUBLE PRECISION NOT NULL,
    "storagePrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageSequence_mediaObjectId_key" ON "ImageSequence"("mediaObjectId");

-- AddForeignKey
ALTER TABLE "ImageSequence" ADD CONSTRAINT "ImageSequence_mediaObjectId_fkey" FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
