-- CreateEnum
CREATE TYPE "WatchTargetType" AS ENUM ('SHOT', 'ASSET', 'VERSION');

-- CreateTable
CREATE TABLE "Watch" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "targetType" "WatchTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watch_targetType_targetId_idx" ON "Watch"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_userId_targetType_targetId_key" ON "Watch"("userId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
