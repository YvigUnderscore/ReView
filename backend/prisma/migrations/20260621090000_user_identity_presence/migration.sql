-- Identité enrichie (prénom/nom/pseudo), statut manuel et présence.

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('AVAILABLE', 'AWAY', 'DND');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
