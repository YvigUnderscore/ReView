-- AlterTable
ALTER TABLE "ReviewReference" ADD COLUMN     "commentId" INTEGER;

-- CreateIndex
CREATE INDEX "ReviewReference_commentId_idx" ON "ReviewReference"("commentId");

-- AddForeignKey
ALTER TABLE "ReviewReference" ADD CONSTRAINT "ReviewReference_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
