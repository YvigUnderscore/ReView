-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "omitted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "department" TEXT;

-- CreateTable
CREATE TABLE "Timeline" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "sequenceId" INTEGER,
    "name" TEXT,
    "department" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineSnapshot" (
    "id" SERIAL NOT NULL,
    "timelineId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineSnapshotItem" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "shotId" INTEGER,
    "shotCode" TEXT NOT NULL,
    "sequenceCode" TEXT,
    "versionId" INTEGER,
    "versionName" TEXT,
    "mediaId" INTEGER,
    "department" TEXT,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "TimelineSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Timeline_projectId_sequenceId_key" ON "Timeline"("projectId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineSnapshot_timelineId_revision_key" ON "TimelineSnapshot"("timelineId", "revision");

-- CreateIndex
CREATE INDEX "TimelineSnapshotItem_snapshotId_order_idx" ON "TimelineSnapshotItem"("snapshotId", "order");

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineSnapshot" ADD CONSTRAINT "TimelineSnapshot_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineSnapshot" ADD CONSTRAINT "TimelineSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineSnapshotItem" ADD CONSTRAINT "TimelineSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TimelineSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rattrapage : les tâches existantes reçoivent la clé de département correspondant à leur
-- type. Les départements par défaut d'un projet portent précisément ces clés ; une tâche
-- OTHER reste sans département et sera rangée en fin de pipe.
UPDATE "Task" SET "department" = "type"::text WHERE "type" <> 'OTHER';
