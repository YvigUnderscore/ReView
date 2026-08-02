// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Redis from 'ioredis';
import { redisConnectionOptions } from './redis';
import { logger } from './logger';

/**
 * Canal redis pub/sub worker → serveur (34.F) : le worker FFmpeg tourne dans un process
 * séparé et ne peut pas émettre de socket — il publie ici, le serveur (SocketService)
 * souscrit et relaie aux rooms concernées. Éphémère par design (pas de persistance) :
 * un client absent au moment de l'événement re-lira l'état via l'API.
 */
export const WORKER_EVENTS_CHANNEL = 'review:worker-events';

/** Rendition HLS prête (échelle progressive) — `building=false` sur la dernière. */
export interface WorkerHlsEvent {
  type: 'hls';
  mediaId: number;
  versionId: number;
  projectId: number | null;
  /** Nombre de renditions déjà disponibles dans le master. */
  renditions: number;
  building: boolean;
}

/** Marqueurs auto posés par la scene detection (34.H) — la review invalide sa liste. */
export interface WorkerMarkersEvent {
  type: 'markers';
  mediaId: number;
}

export type WorkerEvent = WorkerHlsEvent | WorkerMarkersEvent;

export const encodeWorkerEvent = (e: WorkerEvent): string => JSON.stringify(e);

/** Décodage défensif : un message inconnu/corrompu est ignoré (canal partagé). */
export function decodeWorkerEvent(raw: string): WorkerEvent | null {
  try {
    const e = JSON.parse(raw) as { type?: string; mediaId?: unknown; renditions?: unknown };
    if (!e || typeof e.mediaId !== 'number') return null;
    if (e.type === 'hls' && typeof e.renditions === 'number') return e as unknown as WorkerHlsEvent;
    if (e.type === 'markers') return { type: 'markers', mediaId: e.mediaId };
    return null;
  } catch {
    return null;
  }
}

let pub: Redis | null = null;

/** Publication côté worker — best effort : un échec redis ne condamne pas le transcodage. */
export async function publishWorkerEvent(e: WorkerEvent): Promise<void> {
  try {
    pub ??= new Redis(redisConnectionOptions);
    await pub.publish(WORKER_EVENTS_CHANNEL, encodeWorkerEvent(e));
  } catch (err) {
    logger.warn({ err }, '[workerEvents] publication échouée');
  }
}

/** Souscription côté serveur (connexion dédiée : un client redis en mode subscribe est exclusif). */
export function subscribeWorkerEvents(onEvent: (e: WorkerEvent) => void): void {
  const sub = new Redis(redisConnectionOptions);
  void sub.subscribe(WORKER_EVENTS_CHANNEL).catch((err: unknown) => {
    logger.warn({ err }, '[workerEvents] souscription échouée');
  });
  sub.on('message', (_channel: string, raw: string) => {
    const e = decodeWorkerEvent(raw);
    if (e) onEvent(e);
  });
}
