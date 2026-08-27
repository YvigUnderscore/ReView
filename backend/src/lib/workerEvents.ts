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

/**
 * Événement destiné à la room d'un projet, émis depuis le worker.
 *
 * `SocketService.emitToProject` fait `io?.to(...)`, et `io` n'existe que dans le process
 * web : appelé depuis le worker — ce que faisait la synchronisation ShotGrid — il ne
 * produisait rien du tout, en silence. Aucun écran ne se rafraîchissait après une
 * synchronisation, alors que le journal, lui, affichait bien ses compteurs.
 *
 * La charge utile n'est pas typée plus finement : ce canal ne fait que transporter ce que
 * le serveur relaiera tel quel à la room.
 */
export interface WorkerProjectEvent {
  type: 'project';
  projectId: number;
  event: string;
  payload: unknown;
}

export type WorkerEvent = WorkerHlsEvent | WorkerMarkersEvent | WorkerProjectEvent;

export const encodeWorkerEvent = (e: WorkerEvent): string => JSON.stringify(e);

/** Décodage défensif : un message inconnu/corrompu est ignoré (canal partagé). */
export function decodeWorkerEvent(raw: string): WorkerEvent | null {
  try {
    const e = JSON.parse(raw) as {
      type?: string;
      mediaId?: unknown;
      renditions?: unknown;
      projectId?: unknown;
      event?: unknown;
      payload?: unknown;
    };
    if (!e) return null;
    if (e.type === 'project' && typeof e.projectId === 'number' && typeof e.event === 'string') {
      return { type: 'project', projectId: e.projectId, event: e.event, payload: e.payload };
    }
    if (typeof e.mediaId !== 'number') return null;
    if (e.type === 'hls' && typeof e.renditions === 'number') return e as unknown as WorkerHlsEvent;
    if (e.type === 'markers') return { type: 'markers', mediaId: e.mediaId };
    return null;
  } catch {
    return null;
  }
}

let pub: Redis | null = null;
let sub: Redis | null = null;

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
  sub = new Redis(redisConnectionOptions);
  void sub.subscribe(WORKER_EVENTS_CHANNEL).catch((err: unknown) => {
    logger.warn({ err }, '[workerEvents] souscription échouée');
  });
  sub.on('message', (_channel: string, raw: string) => {
    const e = decodeWorkerEvent(raw);
    if (e) onEvent(e);
  });
}

/**
 * Ferme les connexions redis du canal (arrêt propre). Sans cela, le publieur du worker et
 * l'abonné du serveur maintiennent le process en vie après la fermeture du serveur HTTP,
 * jusqu'au SIGKILL de docker.
 */
export async function closeWorkerEvents(): Promise<void> {
  const clients = [pub, sub].filter((c): c is Redis => c !== null);
  pub = null;
  sub = null;
  await Promise.all(
    clients.map((c) =>
      c.quit().catch((err: unknown) => {
        logger.warn({ err }, '[workerEvents] fermeture redis imparfaite');
        c.disconnect();
      }),
    ),
  );
}
