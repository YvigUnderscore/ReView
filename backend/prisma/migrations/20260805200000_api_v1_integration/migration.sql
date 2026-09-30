-- CreateEnum
CREATE TYPE "ApiTokenKind" AS ENUM ('PERSONAL', 'SERVICE');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "ApiTokenKind" NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "projectId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isService" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApiEvent" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "projectId" INTEGER,
    "entityType" TEXT,
    "entityId" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "fingerprint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateIndex
CREATE INDEX "ApiEvent_id_projectId_idx" ON "ApiEvent"("id", "projectId");

-- CreateIndex
CREATE INDEX "ApiEvent_createdAt_idx" ON "ApiEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ApiEvent_event_idx" ON "ApiEvent"("event");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE INDEX "ApiToken_projectId_idx" ON "ApiToken"("projectId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiEvent" ADD CONSTRAINT "ApiEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiEvent" ADD CONSTRAINT "ApiEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

