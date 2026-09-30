-- ─────────────────────────────────────────────────────────────────────────────
-- Webhooks : portée projet et journal des livraisons (vague 3 — flux de changements)
-- ─────────────────────────────────────────────────────────────────────────────
-- Deux manques d'un seul tenant.
--
-- 1. Portée. Un `Webhook` ne connaissait aucun projet et `emitWebhookEvent` sélectionnait
--    tous les abonnés actifs de l'événement : brancher le Slack d'un client sur
--    `version.published` lui envoyait les publications de tous les films du studio, noms
--    de plans compris. `projectId` NULL garde le sens historique — tout le studio — donc
--    les webhooks déjà posés continuent de recevoir exactement ce qu'ils recevaient.
--
-- 2. Trace. Après cinq tentatives une livraison disparaissait : ni ce qui avait été perdu,
--    ni de quoi, ni de quoi rejouer. `WebhookDelivery` garde l'événement, la charge, les
--    tentatives, le statut HTTP et un extrait tronqué de la réponse. Son id sert
--    d'identifiant de livraison (`X-ReView-Delivery`, et `id` dans le corps signé) : c'est
--    lui qui permet au consommateur de dédupliquer une reprise.
--
-- `failureStreak` compte les livraisons définitivement perdues depuis le dernier succès ;
-- au-delà du seuil, le webhook se désactive tout seul au lieu d'occuper la file à vide.

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "projectId" INTEGER,
ADD COLUMN     "failureStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" SERIAL NOT NULL,
    "webhookId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "apiEventId" INTEGER,
    "replayOfId" INTEGER,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Webhook_projectId_idx" ON "Webhook"("projectId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_id_idx" ON "WebhookDelivery"("webhookId", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- AddForeignKey
-- CASCADE et non SET NULL : un webhook dont le projet est supprimé ne doit surtout pas
-- retomber sur la portée « tout le studio » — il livrerait alors davantage qu'avant.
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
