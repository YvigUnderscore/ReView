-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "sourceCommentId" INTEGER;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceCommentId_fkey" FOREIGN KEY ("sourceCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
