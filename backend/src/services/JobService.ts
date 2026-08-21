// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';

/**
 * Files de jobs BullMQ. Les workers FFmpeg (transcodage, miniatures) et la conversion 3D
 * (assimp) sont implémentés dans src/workers/.
 */
export const QUEUE_NAMES = {
  MEDIA: 'media-processing',
  STORAGE_CLEANUP: 'storage-cleanup',
  WEBHOOKS: 'webhooks',
  TIMELINE_EXPORT: 'timeline-export',
  SHOTGRID: 'shotgrid',
  MAINTENANCE: 'maintenance',
} as const;

/**
 * Travaux ShotGrid (Phase 48) : application d'un événement reçu, relevé périodique du
 * journal d'événements, réconciliation, et écritures vers ShotGrid. Une seule file :
 * l'ordre relatif des opérations d'une même connexion compte plus que le parallélisme.
 */
export type ShotgridJobData =
  | { kind: 'event'; connectionId: number; event: unknown; deliveryId?: string | null }
  | { kind: 'poll'; connectionId: number }
  | { kind: 'reconcile'; projectId: number }
  | { kind: 'push'; connectionId: number; push: unknown };

export interface MediaJobData {
  mediaObjectId: number;
  // 'scan' (37.E) : antivirus seul, pour les médias servis tels quels (GLB natif, splats).
  kind: 'transcode' | 'thumbnail' | 'convert3d' | 'trim' | 'scan';
}

export const mediaQueue = new Queue<MediaJobData, void, string>(QUEUE_NAMES.MEDIA, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const enqueueMediaJob = (data: MediaJobData) => mediaQueue.add(data.kind, data);

/**
 * Journal des orphelins storage : quand une suppression MinIO échoue APRÈS que la DB
 * a déjà été purgée (cf. lib/trash), on enfile les clés/préfixes ici pour retry
 * (la DB reste cohérente ; seul l'objet storage subsiste temporairement). Retries
 * automatiques BullMQ (attempts + backoff) traités par workers/storageCleanup.worker.
 */
export interface StorageCleanupJobData {
  keys?: string[];
  prefixes?: string[];
}

export const storageCleanupQueue = new Queue<StorageCleanupJobData, void, string>(
  QUEUE_NAMES.STORAGE_CLEANUP,
  {
    connection: redisConnectionOptions,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential', delay: 15000 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  },
);

export const enqueueStorageCleanup = (data: StorageCleanupJobData) =>
  storageCleanupQueue.add('cleanup', data);

/** Livraison de webhook (36.D) : un job par webhook abonné, retries automatiques. */
export interface WebhookJobData {
  webhookId: number;
  event: string;
  payload: Record<string, unknown>;
}

export const webhookQueue = new Queue<WebhookJobData, void, string>(QUEUE_NAMES.WEBHOOKS, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

export const enqueueWebhookDelivery = (data: WebhookJobData) => webhookQueue.add(data.event, data);

export const shotgridQueue = new Queue<ShotgridJobData, void, string>(QUEUE_NAMES.SHOTGRID, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // Une seule tentative pour les événements : la réconciliation périodique rattrape
    // ce qui a échoué, mieux qu'un empilement de reprises sur un site indisponible.
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Export d'un montage en fichier unique (Phase 45). Un seul job à la fois par montage :
 * l'identifiant de job est déterministe, BullMQ ignore silencieusement un doublon — deux
 * clics sur « exporter » ne lancent pas deux encodages du même film.
 */
export interface TimelineExportJobData {
  timelineId: number;
  requestedById: number;
}

export const timelineExportQueue = new Queue<TimelineExportJobData, void, string>(
  QUEUE_NAMES.TIMELINE_EXPORT,
  {
    connection: redisConnectionOptions,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);

export const timelineExportJobId = (timelineId: number) => `timeline-${timelineId}`;

export const enqueueTimelineExport = (data: TimelineExportJobData) =>
  timelineExportQueue.add('export', data, { jobId: timelineExportJobId(data.timelineId) });

/**
 * Entretien périodique (digest quotidien, rapport hebdomadaire, purges).
 *
 * Ces trois rendez-vous vivaient dans des `setInterval` du process API : ils mouraient
 * avec lui, se dupliquaient sur deux répliques, et rien ne disait s'ils avaient eu lieu.
 * Passés en file, ils sont posés par l'API (qui seule connaît `DIGEST_HOUR`) et exécutés
 * par le worker, avec l'historique, les reprises et le tableau de bord des autres files.
 */
export type MaintenanceJobData = { kind: 'daily-digest' } | { kind: 'weekly-report' } | { kind: 'purge' };

export const maintenanceQueue = new Queue<MaintenanceJobData, void, string>(QUEUE_NAMES.MAINTENANCE, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // Un rendez-vous manqué est rattrapé par le suivant : mieux vaut deux tentatives
    // qu'un empilement de reprises sur un SMTP durablement injoignable.
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Toutes les files déclarées — source unique pour les métriques et le tableau de bord.
 *
 * L'étiquette n'est pas le nom de file : `media-processing` s'expose depuis toujours
 * sous `queue="media"` dans Prometheus, dans le tableau Grafana provisionné et dans la
 * documentation d'exploitation. La renommer casserait les requêtes existantes.
 */
export const QUEUE_LABELS = {
  media: mediaQueue,
  'storage-cleanup': storageCleanupQueue,
  webhooks: webhookQueue,
  'timeline-export': timelineExportQueue,
  shotgrid: shotgridQueue,
  maintenance: maintenanceQueue,
} as const;

export type QueueLabel = keyof typeof QUEUE_LABELS;

export const ALL_QUEUES = Object.entries(QUEUE_LABELS) as ReadonlyArray<readonly [QueueLabel, Queue]>;

/**
 * Ferme toutes les files (arrêt propre du process API) : sans cela, les connexions Redis
 * des `Queue` maintiennent le process en vie après `server.close()`.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(QUEUE_LABELS).map((q) => q.close()));
}
