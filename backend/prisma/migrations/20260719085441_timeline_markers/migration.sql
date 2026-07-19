-- CreateTable
CREATE TABLE "TimelineMarker" (
    "id" SERIAL NOT NULL,
    "mediaObjectId" INTEGER NOT NULL,
    "frame" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22d3ee',
    "authorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineMarker_mediaObjectId_idx" ON "TimelineMarker"("mediaObjectId");

-- AddForeignKey
ALTER TABLE "TimelineMarker" ADD CONSTRAINT "TimelineMarker_mediaObjectId_fkey" FOREIGN KEY ("mediaObjectId") REFERENCES "MediaObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineMarker" ADD CONSTRAINT "TimelineMarker_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
