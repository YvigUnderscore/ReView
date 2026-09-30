-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "typeLabel" TEXT;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "pipelineStatusId" INTEGER;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_pipelineStatusId_fkey" FOREIGN KEY ("pipelineStatusId") REFERENCES "PipelineStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
