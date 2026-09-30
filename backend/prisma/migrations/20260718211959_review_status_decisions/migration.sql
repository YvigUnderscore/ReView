-- AlterTable
ALTER TABLE "Version" ADD COLUMN     "reviewStatusId" INTEGER;

-- CreateTable
CREATE TABLE "ReviewStatus" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isApproval" BOOLEAN NOT NULL DEFAULT false,
    "isRetake" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "statusId" INTEGER NOT NULL,
    "comment" TEXT,
    "authorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewStatus_name_key" ON "ReviewStatus"("name");

-- CreateIndex
CREATE INDEX "ReviewDecision_versionId_createdAt_idx" ON "ReviewDecision"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_reviewStatusId_fkey" FOREIGN KEY ("reviewStatusId") REFERENCES "ReviewStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "ReviewStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
