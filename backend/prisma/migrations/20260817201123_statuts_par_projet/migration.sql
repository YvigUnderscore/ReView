-- DropIndex
DROP INDEX "PipelineStatus_scope_code_key";

-- DropIndex
DROP INDEX "PipelineStatus_scope_order_idx";

-- AlterTable
ALTER TABLE "PipelineStatus" ADD COLUMN     "projectId" INTEGER;

-- CreateIndex
CREATE INDEX "PipelineStatus_projectId_scope_order_idx" ON "PipelineStatus"("projectId", "scope", "order");

-- AddForeignKey
ALTER TABLE "PipelineStatus" ADD CONSTRAINT "PipelineStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Unicité du code (index partiels)
-- ─────────────────────────────────────────────────────────────────────────────
-- Même raison que pour Department : les NULL étant distincts, un index unique ordinaire
-- ne protégerait pas le référentiel du studio.
CREATE UNIQUE INDEX "PipelineStatus_studio_code_unique" ON "PipelineStatus"("scope", "code")
  WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX "PipelineStatus_project_code_unique" ON "PipelineStatus"("projectId", "scope", "code")
  WHERE "projectId" IS NOT NULL;

-- Le vocabulaire local de plan et de séquence est semé par la migration suivante
-- (20260817202500) : il demandait d'abord d'élargir l'unicité du référentiel studio à
-- l'origine, deux statuts pouvant partager un code selon qu'ils viennent du site ou de
-- ReView.
