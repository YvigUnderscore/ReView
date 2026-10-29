// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { emitToProject, isWorkerProcess } from '../SocketService';
import { publishWorkerEvent } from '../../lib/workerEvents';

/**
 * What a synchronization pass really touched.
 *
 * Each realigned entity used to emit its own socket event. On a full pass of a feature film, that makes twelve thousand emissions — and on the browser side, five query
 * invalidations per emission. The screen is no more accurate for it: it spends the duration of the pass reloading itself.
 *
 * So we accumulate, and decide at the end:
 * - a pass that stayed small (re-reading a webhook, realigning a card): the fine events are replayed as they are, and the screen updates in the right place;
 * - a wide pass: a single summary, with the count per family — it is up to the client to reload what it displays, once.
 *
 * The collector is deliberately dependency-free: it knows neither socket nor database, which makes it verifiable on its own.
 */

/** Families for which a fine-grained event already exists on the client side. */
export type ReplayableKind = 'sequence' | 'shot' | 'asset' | 'task' | 'version';

/** Notes and playlists have no fine-grained event: they only travel as a count. */
export type TouchedKind = ReplayableKind | 'comment' | 'playlist';

export const TOUCHED_EVENT_NAME: Record<ReplayableKind, string> = {
  sequence: 'sequence:update',
  shot: 'shot:update',
  asset: 'asset:update',
  task: 'task:update',
  version: 'version:update',
};

export function isReplayable(kind: TouchedKind): kind is ReplayableKind {
  return Object.prototype.hasOwnProperty.call(TOUCHED_EVENT_NAME, kind);
}

/**
 * Beyond this number of distinct entities, the pass no longer replays the detail.
 *
 * Twenty-five amply covers the common case — a webhook concerns one entity, a manual realignment one as well — while staying below the threshold where the client's grouped
 * invalidation costs less than unit invalidations.
 */
export const DETAIL_LIMIT = 25;

export interface TouchedEvent {
  kind: ReplayableKind;
  id: number;
    /** Additional fields expected by the client (a task's links, for example). */
  extra?: Record<string, unknown>;
}

export interface TouchedSummary {
  counts: Partial<Record<TouchedKind, number>>;
  total: number;
    /** `true`: the fine-grained events have been replayed, the client has nothing to reload wholesale. */
  detailed: boolean;
}

export class TouchedEntities {
  private readonly events: TouchedEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly tally = new Map<TouchedKind, number>();

    /**
     * Notes a touched entity. The same entity seen twice in the pass counts only once: the count says "how many objects moved", not "how many
     * writes took place".
     */
  add(kind: TouchedKind, id: number, extra?: Record<string, unknown>): void {
    const key = `${kind}:${id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.tally.set(kind, (this.tally.get(kind) ?? 0) + 1);

    if (!isReplayable(kind)) return;
        // Past the threshold, the detail will no longer be used: retaining it would make a full pass bear the weight of twelve thousand objects to emit nothing.
    if (this.seen.size > DETAIL_LIMIT) {
      this.events.length = 0;
      return;
    }
    this.events.push(extra ? { kind, id, extra } : { kind, id });
  }

  get total(): number {
    return this.seen.size;
  }

  get detailed(): boolean {
    return this.seen.size <= DETAIL_LIMIT;
  }

    /** Fine-grained events to replay — empty as soon as the pass has exceeded the threshold. */
  detail(): TouchedEvent[] {
    return this.detailed ? [...this.events] : [];
  }

  summary(): TouchedSummary {
    return {
      counts: Object.fromEntries(this.tally),
      total: this.total,
      detailed: this.detailed,
    };
  }
}

/**
 * End of pass: we emit, once.
 *
 * Small pass: the fine-grained events are replayed — the screen updates exactly where it needs to. Large pass: a single `shotgrid:sync` carries the count per family and
 * `detailed: false`: it is up to the client to reload what it displays, once, instead of suffering twelve thousand invalidations.
 *
 * The summary goes out in every case, including when the pass failed along the way: what it has already realigned is real and must reach the open screens.
 */
export function flushTouched(
  projectId: number,
  runId: number,
  status: 'ok' | 'error',
  touched: TouchedEntities,
): void {
  for (const event of touched.detail()) {
    emitProject(projectId, TOUCHED_EVENT_NAME[event.kind], {
      projectId,
      id: event.id,
      ...event.extra,
    });
  }
  emitProject(projectId, 'shotgrid:sync', { projectId, runId, status, ...touched.summary() });
}

/**
 * Emission to a project's room, whichever process it is spoken from.
 *
 * The ShotGrid synchronization runs in the **worker** process, where `emitToProject` does `io?.to(...)` on an `io` that is `undefined`: the emission was a silent no-op, and
 * no screen refreshed after a pass. The worker therefore goes through the Redis channel, which the server relays; the web process, for its part, emits directly.
 */
function emitProject(projectId: number, event: string, payload: unknown): void {
  if (isWorkerProcess()) {
    void publishWorkerEvent({ type: 'project', projectId, event, payload });
    return;
  }
  emitToProject(projectId, event, payload);
}
