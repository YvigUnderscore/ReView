-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "pipelineStatusId" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "pipelineStatusId" INTEGER;

-- CreateTable
CREATE TABLE "PipelineStatus" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "legacyStatus" "TaskStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotgridSite" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authMode" TEXT NOT NULL DEFAULT 'script',
    "scriptName" TEXT,
    "scriptKey" TEXT,
    "login" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShotgridSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotgridConnection" (
    "id" SERIAL NOT NULL,
    "siteId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "sgProjectId" INTEGER NOT NULL,
    "sgProjectName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "webhookToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastEventId" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShotgridConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotgridLink" (
    "id" SERIAL NOT NULL,
    "connectionId" INTEGER NOT NULL,
    "localType" TEXT NOT NULL,
    "localId" INTEGER NOT NULL,
    "sgType" TEXT NOT NULL,
    "sgId" INTEGER NOT NULL,
    "sgUpdatedAt" TIMESTAMP(3),
    "data" JSONB NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShotgridLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotgridSyncRun" (
    "id" SERIAL NOT NULL,
    "connectionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "triggeredById" INTEGER,

    CONSTRAINT "ShotgridSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotgridSyncLog" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "sgType" TEXT,
    "sgId" INTEGER,
    "localType" TEXT,
    "localId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShotgridSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStatus_scope_order_idx" ON "PipelineStatus"("scope", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStatus_scope_code_key" ON "PipelineStatus"("scope", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridSite_baseUrl_key" ON "ShotgridSite"("baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridConnection_projectId_key" ON "ShotgridConnection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridConnection_webhookToken_key" ON "ShotgridConnection"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridConnection_siteId_sgProjectId_key" ON "ShotgridConnection"("siteId", "sgProjectId");

-- CreateIndex
CREATE INDEX "ShotgridLink_connectionId_localType_idx" ON "ShotgridLink"("connectionId", "localType");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridLink_connectionId_sgType_sgId_key" ON "ShotgridLink"("connectionId", "sgType", "sgId");

-- CreateIndex
CREATE UNIQUE INDEX "ShotgridLink_connectionId_localType_localId_key" ON "ShotgridLink"("connectionId", "localType", "localId");

-- CreateIndex
CREATE INDEX "ShotgridSyncRun_connectionId_startedAt_idx" ON "ShotgridSyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "ShotgridSyncLog_runId_createdAt_idx" ON "ShotgridSyncLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ShotgridSyncLog_level_resolvedAt_idx" ON "ShotgridSyncLog"("level", "resolvedAt");

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_pipelineStatusId_fkey" FOREIGN KEY ("pipelineStatusId") REFERENCES "PipelineStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pipelineStatusId_fkey" FOREIGN KEY ("pipelineStatusId") REFERENCES "PipelineStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridConnection" ADD CONSTRAINT "ShotgridConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ShotgridSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridConnection" ADD CONSTRAINT "ShotgridConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridLink" ADD CONSTRAINT "ShotgridLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ShotgridConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridSyncRun" ADD CONSTRAINT "ShotgridSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ShotgridConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridSyncRun" ADD CONSTRAINT "ShotgridSyncRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotgridSyncLog" ADD CONSTRAINT "ShotgridSyncLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ShotgridSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed des statuts de tâche par défaut, repris de l'enum TaskStatus, puis
-- rattachement des tâches existantes. Le référentiel démarre ainsi à l'identique
-- de l'existant : aucune tâche ne perd son statut, et un studio sans ShotGrid
-- garde exactement l'affichage qu'il connaît.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "PipelineStatus" ("scope", "code", "name", "color", "order", "isDone", "isDefault", "legacyStatus", "updatedAt") VALUES
  ('task', 'todo',           'To Do',       '#6B7280', 0, false, true,  'TODO',           CURRENT_TIMESTAMP),
  ('task', 'in_progress',    'In Progress', '#3B82F6', 1, false, false, 'IN_PROGRESS',    CURRENT_TIMESTAMP),
  ('task', 'pending_review', 'To Review',   '#F59E0B', 2, false, false, 'PENDING_REVIEW', CURRENT_TIMESTAMP),
  ('task', 'retake',         'Retake',      '#D946EF', 3, false, false, 'RETAKE',         CURRENT_TIMESTAMP),
  ('task', 'rejected',       'Rejected',    '#EF4444', 4, false, false, 'REJECTED',       CURRENT_TIMESTAMP),
  ('task', 'approved',       'Approved',    '#22C55E', 5, true,  false, 'APPROVED',       CURRENT_TIMESTAMP);

UPDATE "Task" t
SET "pipelineStatusId" = ps."id"
FROM "PipelineStatus" ps
WHERE ps."scope" = 'task' AND ps."legacyStatus" = t."status";
