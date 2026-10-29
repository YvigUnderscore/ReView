// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Redis from 'ioredis';
import { redisConnectionOptions } from './redis';
import { logger } from './logger';

/**
 * Redis pub/sub channel from worker to server (34.F). The FFmpeg worker runs in a separate process
 * and cannot emit a socket: it publishes here, and the server (SocketService) subscribes and relays
 * to the relevant rooms. Ephemeral by design (no persistence): a client absent at the time of the
 * event will re-read the state via the API.
 */
export const WORKER_EVENTS_CHANNEL = 'review:worker-events';

/** Ready HLS rendition (progressive ladder): `building=false` on the last one. */
export interface WorkerHlsEvent {
  type: 'hls';
  mediaId: number;
  versionId: number;
  projectId: number | null;
  /** Number of renditions already available in the master. */
  renditions: number;
  building: boolean;
}

/** Automatic markers placed by scene detection (34.H): the review invalidates its list. */
export interface WorkerMarkersEvent {
  type: 'markers';
  mediaId: number;
}

/**
 * Event meant for a project's room, emitted from the worker.
 *
 * `SocketService.emitToProject` calls `io?.to(...)`, and `io` only exists in the web process:
 * called from the worker, as the ShotGrid sync did, it silently produced nothing at all. No screen
 * refreshed after a sync, even though the log did display its counters.
 *
 * The payload is not typed more finely: this channel only carries what the server will relay as is
 * to the room.
 */
export interface WorkerProjectEvent {
  type: 'project';
  projectId: number;
  event: string;
  payload: unknown;
}

export type WorkerEvent = WorkerHlsEvent | WorkerMarkersEvent | WorkerProjectEvent;

export const encodeWorkerEvent = (e: WorkerEvent): string => JSON.stringify(e);

/** Defensive decoding: an unknown or corrupted message is ignored (shared channel). */
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

/** Publishing on the worker side, best effort: a redis failure does not doom the transcoding. */
export async function publishWorkerEvent(e: WorkerEvent): Promise<void> {
  try {
    pub ??= new Redis(redisConnectionOptions);
    await pub.publish(WORKER_EVENTS_CHANNEL, encodeWorkerEvent(e));
  } catch (err) {
    logger.warn({ err }, '[workerEvents] publish failed');
  }
}

/** Subscription on the server side (dedicated connection: a redis client in subscribe mode is exclusive). */
export function subscribeWorkerEvents(onEvent: (e: WorkerEvent) => void): void {
  sub = new Redis(redisConnectionOptions);
  void sub.subscribe(WORKER_EVENTS_CHANNEL).catch((err: unknown) => {
    logger.warn({ err }, '[workerEvents] subscription failed');
  });
  sub.on('message', (_channel: string, raw: string) => {
    const e = decodeWorkerEvent(raw);
    if (e) onEvent(e);
  });
}

/**
 * Closes the channel's redis connections (clean shutdown). Without this, the worker's publisher and
 * the server's subscriber keep the process alive after the HTTP server closes, until docker's SIGKILL.
 */
export async function closeWorkerEvents(): Promise<void> {
  const clients = [pub, sub].filter((c): c is Redis => c !== null);
  pub = null;
  sub = null;
  await Promise.all(
    clients.map((c) =>
      c.quit().catch((err: unknown) => {
        logger.warn({ err }, '[workerEvents] unclean redis shutdown');
        c.disconnect();
      }),
    ),
  );
}
