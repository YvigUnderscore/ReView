-- Fiche de séquence (C3) : description et vignette, que seules les autres entités avaient.
ALTER TABLE "Sequence" ADD COLUMN "description" TEXT;
ALTER TABLE "Sequence" ADD COLUMN "thumbnailKey" TEXT;
