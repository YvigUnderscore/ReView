-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "thumbnailKey" TEXT;

-- AlterTable
ALTER TABLE "MediaObject" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "thumbnailKey" TEXT;

-- AlterTable
ALTER TABLE "Version" ADD COLUMN     "deletedAt" TIMESTAMP(3);
