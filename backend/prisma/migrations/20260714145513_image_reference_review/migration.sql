-- CreateTable
CREATE TABLE "ReviewReference" (
    "id" SERIAL NOT NULL,
    "mediaObjectId" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReference_mediaObjectId_key" ON "ReviewReference"("mediaObjectId");

-- AddForeignKey
ALTER TABLE "ReviewReference" ADD CONSTRAINT "ReviewReference_mediaObjectId_fkey" FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReference" ADD CONSTRAINT "ReviewReference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
