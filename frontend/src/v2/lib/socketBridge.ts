// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { emitActivity, getSocket } from '../../lib/socket';
import { qk } from './query';
import { presenceKey, type PresenceUser } from './queries';

/** Payloads of the real-time events emitted by the backend routes (10.E3). */
interface TaskEvent {
  projectId: number;
  id: number;
  shotId: number | null;
  assetId: number | null;
}
interface VersionEvent {
  projectId: number;
  id: number;
  taskId: number | null;
  assetId: number | null;
}
interface MediaEvent {
  projectId: number;
  id: number;
  versionId: number;
}
/**
 * Shot, sequence or asset: the server only emits the project/identifier pair.
 *
 * `ids` is the "batch" part: a production action on thirty shots emits ONE event carrying them all,
 * instead of thirty single events. `id` is still filled in (first of the batch) for the consumers that
 * do not read `ids`.
 */
interface EntityEvent {
  projectId: number;
  id: number;
  ids?: number[];
}

const COMMENT_EVENTS = [
  'comment:new',
  'comment:update',
  'comment:delete',
  'comment:reaction',
  'comment:reaction:remove',
];

/**
 * Grouping window for invalidations (ms).
 *
 * This is the MAXIMUM delay between a remote change and its display, not a systematic delay: the first
 * invalidation of a burst goes out as early as possible (cf. `add`). Two tenths of a second are not
 * visible to the eye; lengthening them would give an interface that "no longer moves", which would be
 * worse than the problem being handled.
 */
export const COALESCE_WINDOW_MS = 200;

/**
 * Beyond this number of entities in a batch, we invalidate the entity prefix rather than one key per
 * identifier: walking the cache a thousand times for a thousand records of which only one is on screen
 * costs more than the refresh we are trying to avoid.
 */
const MAX_BATCH_KEYS = 50;

type QueryKey = readonly unknown[];

/** Is `a` a prefix of `b`? (Query invalidations match by prefix) */
function isPrefix(a: QueryKey, b: QueryKey): boolean {
  return a.length <= b.length && a.every((part, i) => Object.is(part, b[i]));
}

/**
 * Removes from a batch the keys that another key of the same batch already invalidates.
 *
 * `invalidateQueries` matches by prefix: invalidating `['shot', 7]` then `['shot', 7, 'tree']` touched
 * the tree request twice — and since `invalidateQueries` cancels the in-flight request by default to
 * start a new one, the second discarded the response of the first. One HTTP request in two, on a shot
 * record, was being abandoned.
 *
 * The keys received are unique (de-duplicated by their serialised form upstream): two entries with
 * identical content can therefore not eliminate each other.
 */
export function dropRedundantKeys(keys: QueryKey[]): QueryKey[] {
  return keys.filter((key) => !keys.some((other) => other !== key && isPrefix(other, key)));
}

interface InvalidationQueue {
  add(key: QueryKey): void;
  dispose(): void;
}

/**
 * Coalesced invalidation queue.
 *
 * A batch of statuses on thirty shots emitted thirty `shot:update`, and each one reloaded the whole
 * kanban — the heaviest read in the application — for each person who had it open. The first
 * twenty-nine responses were thrown away: `invalidateQueries` cancels the request in flight before
 * starting another one.
 *
 * The grouping is a "leading-edge throttle", not a debounce: the first invalidation goes out right
 * away (within one turn of the loop, while all the keys of the same event join the batch), the next
 * ones are held back at most `COALESCE_WINDOW_MS`. A simple debounce would have pushed the display back
 * to the end of the burst: on a batch that takes three seconds to write on the server side, the screen
 * would have stayed frozen throughout.
 */
function createInvalidationQueue(qc: QueryClient): InvalidationQueue {
  const pending = new Map<string, QueryKey>();
  let lead: ReturnType<typeof setTimeout> | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    lead = null;
    const keys = dropRedundantKeys([...pending.values()]);
    pending.clear();
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    // Guard window: whatever arrives now waits here rather than re-running the same requests straight
    // away. It closes on its own if nothing comes.
    guard = setTimeout(() => {
      guard = null;
      if (pending.size > 0) flush();
    }, COALESCE_WINDOW_MS);
  };

  return {
    add(key: QueryKey): void {
      pending.set(JSON.stringify(key), key);
      // A batch is already scheduled, or the window is running: it will carry this key.
      if (lead || guard) return;
      // Zero delay rather than a direct call: the four or five keys of the same event thus join the
      // same batch, and de-duplicate among themselves.
      lead = setTimeout(flush, 0);
    },
    dispose(): void {
      if (lead) clearTimeout(lead);
      if (guard) clearTimeout(guard);
      lead = null;
      guard = null;
      pending.clear();
    },
  };
}

/** Identifiers carried by an entity event: the batch if there is one, otherwise the single one. */
const entityIds = (e: EntityEvent): number[] => (e.ids?.length ? e.ids : [e.id]);

/** Period of the background activity heartbeat (ms) — unchanged. */
const HEARTBEAT_MS = 60_000;

/**
 * Minimum interval between two `activity` frames (ms).
 *
 * The server-side inactivity window is counted in minutes: one frame every thirty seconds is enough to
 * tell "in front of the screen" from "away", and remains twice as fine as the background heartbeat.
 */
export const ACTIVITY_THROTTLE_MS = 30_000;

/**
 * `presence:update` push → Query cache.
 *
 * The server only sends the identifiers online: we rewrite the `online` flag of the people already in
 * cache rather than asking for the directory again. An updater returning `undefined` creates no entry:
 * if nobody displays the directory, the push costs nothing. Unchanged objects are returned as they are,
 * so as not to re-render the whole list on every heartbeat.
 */
function applyPresencePush(qc: QueryClient, onlineUserIds: number[]): void {
  const online = new Set(onlineUserIds);
  qc.setQueryData<PresenceUser[]>(presenceKey, (prev) =>
    prev?.map((u) => (u.online === online.has(u.id) ? u : { ...u, online: online.has(u.id) })),
  );
}

/**
 * Presence part of the bridge: real-time push to the cache, and activity heartbeat.
 *
 * Both used to live in `usePresence`, therefore in EACH consumer of the directory: two panels mounted
 * together set up two socket subscriptions, two timers and two sets of window listeners — and each
 * emitted an `activity` frame per keystroke, that is forty frames for a sentence typed in a review note.
 * Installed once at the bridge level, the behaviour is the same for a fixed cost.
 */
export function usePresenceBridge(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const onPresence = (data: { onlineUserIds: number[] }) => {
      applyPresencePush(qc, data.onlineUserIds);
    };
    socket.on('presence:update', onPresence);
    return () => {
      socket.off('presence:update', onPresence);
    };
  }, [qc]);

  useEffect(() => {
    // `last` at zero: the very first frame goes out on mount, without waiting for the threshold.
    let last = 0;
    const ping = (): void => {
      const now = Date.now();
      if (now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      emitActivity();
    };
    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);
    window.addEventListener('click', ping);
    window.addEventListener('keydown', ping);
    return () => {
      clearInterval(interval);
      window.removeEventListener('click', ping);
      window.removeEventListener('keydown', ping);
    };
  }, []);
}

/**
 * Real-time bridge → Query cache (10.E3): joins the current project's room (RBAC re-checked server-side
 * on each join) and translates each socket event into targeted invalidations. An invalidation only
 * re-fetches the queries currently mounted: zero cost for the screens not concerned.
 */
export function useSocketInvalidation(projectId: number | null): void {
  const qc = useQueryClient();

  // Mounted here because the bridge is itself mounted once and for all for the application:
  // it is the only place where the presence directory can have a single subscription.
  usePresenceBridge();

  // Joins the current project's room; re-join after a socket reconnection.
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();
    const join = () => socket.emit('join_project', projectId);
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      // Leave the room on the way out (D3): without this, a tab open all day
      // receives the events of every project visited since the morning.
      socket.emit('leave_project', projectId);
    };
  }, [projectId]);

  useEffect(() => {
    const socket = getSocket();
    const q = createInvalidationQueue(qc);
    // Comment payloads do not always expose the mediaObjectId (delete,
    // reactions): invalidation by prefix — only the mounted review re-fetches.
    const onComment = () => {
      q.add(['comments']);
    };
    const onTask = (e: TaskEvent) => {
      if (e.shotId != null) q.add(qk.tasks(e.shotId));
      q.add(qk.task(e.id));
      q.add(qk.projectActivity(e.projectId));
    };
    const onVersion = (e: VersionEvent) => {
      const parent =
        e.taskId != null ? `taskId=${e.taskId}` : e.assetId != null ? `assetId=${e.assetId}` : null;
      if (parent) q.add(qk.versions(parent));
      q.add(qk.version(e.id));
      q.add(qk.projectActivity(e.projectId));
      q.add(['asset']);
      q.add(['timeline']);
    };
    const onMedia = (e: MediaEvent) => {
      // Never invalidate qk.media(id): presigned URLs with staleTime Infinity
      // (10.E1) — a refetch would reload the viewer in the middle of playback.
      q.add(qk.version(e.versionId));
      q.add(['versions']);
      q.add(qk.projectActivity(e.projectId));
      // Publishing a media advances the asset and the edit: that is the whole point of
      // the auto-timeline (Phase 45), it must update without a reload.
      q.add(['asset']);
      q.add(['timeline']);
    };
    const onTimeline = () => {
      q.add(['timeline']);
    };
    /**
     * Shots, sequences and assets — the server already emitted these three events and nobody
     * listened to them: a status changed elsewhere (by a colleague, or read from ShotGrid) never reached
     * an open screen. You had to reload the page to see it, which gave the impression that the change
     * had not gone through.
     *
     * `qk.shotTree`/`qk.assetTree` are no longer cited: `qk.shot`/`qk.asset` are their prefix and
     * already invalidate them (cf. `dropRedundantKeys`).
     */
    const onShot = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['shot']);
      else for (const id of ids) q.add(qk.shot(id));
      q.add(qk.shots(e.projectId));
      q.add(qk.projectBoard(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    const onSequence = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['sequence']);
      else for (const id of ids) q.add(qk.sequence(id));
      q.add(qk.sequences(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    const onAsset = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['asset']);
      else for (const id of ids) q.add(qk.asset(id));
      q.add(qk.assets(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    COMMENT_EVENTS.forEach((ev) => socket.on(ev, onComment));
    socket.on('task:update', onTask);
    socket.on('version:update', onVersion);
    socket.on('media:update', onMedia);
    socket.on('timeline:update', onTimeline);
    socket.on('shot:update', onShot);
    socket.on('sequence:update', onSequence);
    socket.on('asset:update', onAsset);
    return () => {
      COMMENT_EVENTS.forEach((ev) => socket.off(ev, onComment));
      socket.off('task:update', onTask);
      socket.off('version:update', onVersion);
      socket.off('media:update', onMedia);
      socket.off('timeline:update', onTimeline);
      socket.off('shot:update', onShot);
      socket.off('sequence:update', onSequence);
      socket.off('asset:update', onAsset);
      q.dispose();
    };
  }, [qc]);
}
