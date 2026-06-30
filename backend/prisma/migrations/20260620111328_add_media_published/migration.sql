-- AlterTable
ALTER TABLE "MediaObject" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- Backfill : les médias existants restent visibles (publiés rétroactivement)
UPDATE "MediaObject" SET "published" = true;
