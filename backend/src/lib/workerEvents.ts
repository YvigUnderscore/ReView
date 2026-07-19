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

export const encodeWorkerEvent = (e: WorkerHlsEvent): string => JSON.stringify(e);

/** Décodage défensif : un message inconnu/corrompu est ignoré (canal partagé). */
export function decodeWorkerEvent(raw: string): WorkerHlsEvent | null {
  try {
    const e = JSON.parse(raw) as Partial<WorkerHlsEvent>;
    return e && e.type === 'hls' && typeof e.mediaId === 'number' && typeof e.renditions === 'number'
      ? (e as WorkerHlsEvent)
      : null;
  } catch {
    return null;
  }
}

let pub: Redis | null = null;

/** Publication côté worker — best effort : un échec redis ne condamne pas le transcodage. */
export async function publishWorkerEvent(e: WorkerHlsEvent): Promise<void> {
  try {
    pub ??= new Redis(redisConnectionOptions);
    await pub.publish(WORKER_EVENTS_CHANNEL, encodeWorkerEvent(e));
  } catch (err) {
    logger.warn({ err }, '[workerEvents] publication échouée');
  }
}

/** Souscription côté serveur (connexion dédiée : un client redis en mode subscribe est exclusif). */
export function subscribeWorkerEvents(onEvent: (e: WorkerHlsEvent) => void): void {
  const sub = new Redis(redisConnectionOptions);
  void sub.subscribe(WORKER_EVENTS_CHANNEL).catch((err: unknown) => {
    logger.warn({ err }, '[workerEvents] souscription échouée');
  });
  sub.on('message', (_channel: string, raw: string) => {
    const e = decodeWorkerEvent(raw);
    if (e) onEvent(e);
  });
}
