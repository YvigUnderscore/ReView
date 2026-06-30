-- Favoris (étoile) et documentation (rich text / PDF) rattachables au pipeline.

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PROJECT', 'SEQUENCE', 'SHOT', 'ASSET');
CREATE TYPE "DocScope" AS ENUM ('GLOBAL', 'PROJECT', 'SEQUENCE', 'SHOT', 'ASSET');
CREATE TYPE "DocKind" AS ENUM ('RICH', 'PDF');

-- CreateTable
CREATE TABLE "Favorite" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "EntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "DocKind" NOT NULL DEFAULT 'RICH',
    "content" TEXT,
    "fileKey" TEXT,
    "scope" "DocScope" NOT NULL DEFAULT 'GLOBAL',
    "projectId" INTEGER,
    "scopeId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");
CREATE UNIQUE INDEX "Favorite_userId_type_entityId_key" ON "Favorite"("userId", "type", "entityId");
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");
CREATE INDEX "Document_scope_scopeId_idx" ON "Document"("scope", "scopeId");

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
