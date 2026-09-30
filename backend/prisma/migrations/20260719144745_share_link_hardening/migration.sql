-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "label" TEXT,
ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "maxViews" INTEGER,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;
