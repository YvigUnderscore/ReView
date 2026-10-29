// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../lib/logger';
import {
  getRedis,
  INSTANCE_ID,
  onHeartbeat,
  parseJson,
  publishRedis,
  redisNullableStrings,
  redisStrings,
  subscribeRedis,
} from '../lib/redis';

/**
 * Live review room (33.B) — **shared** state (Redis) of the synchronised sessions.
 *
 * A session is identified by a key `media:<id>` or `playlist:<id>`; the first arrival becomes the pilot,
 * control is handed over explicitly, and the last departure closes the
 * session. The pilot may name **co-pilots**: among them, the effective "driver" (whose playback is
 * authoritative) is the last to have interacted. The RBAC (project access)
 * is checked by the socket layer before any join.
 *
 * The state used to live in a process `Map`: a dailies room disappeared at each server restart, and would
 * have split in two on a second replica. It now lives in Redis, under a
 * **per-session lock** (concurrent read-modify-write), each participant carrying an expiry: a replica killed
 * in the middle of a session does not leave its participants in the room
 * for ever.
 *
 * Reads remain **synchronous**: they query a local mirror, refreshed at each local mutation, at each
 * notification from another replica, and at the heartbeat. `listLiveSessions` is
 * called from a route, `canDriveLive` on the hot path of `live:sync` — neither can afford a Redis round trip.
 */

export interface LiveParticipant {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

export interface LiveState {
  key: string;
  pilotId: number;
  coHostIds: number[];
  /** Pilot or co-pilot whose broadcast is authoritative (last to have interacted). */
  driverId: number;
  participants: LiveParticipant[];
}

/** Target resolved at join (RBAC) — allows listing a project's sessions (LIVE badges). */
export interface LiveSessionMeta {
  projectId: number;
  mediaId?: number;
  playlistId?: number;
  versionId?: number;
}

/** A project's session seen from outside (badges on the review and the version cards). */
export interface LiveSessionSummary extends LiveSessionMeta {
  key: string;
  participantCount: number;
  pilot: LiveParticipant | null;
}

/** Stored participant: identity, arrival (order), lease expiry. */
interface StoredParticipant {
  p: LiveParticipant;
  j: number;
  e: number;
}

interface StoredSession {
  pilotId: number;
  coHostIds: number[];
  driverId: number;
  participants: StoredParticipant[];
  meta?: LiveSessionMeta;
}

/** Grace period before a disconnected participant is effectively removed: a page reload (F5) keeps its role. */
export const LIVE_LEAVE_GRACE_MS = 10_000;
/** A participant's lease: beyond it, the replica carrying it is presumed dead. */
export const LIVE_PARTICIPANT_TTL_MS = 90_000;
/** The session's lease: last-resort safety net in case the index were to lie. */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 2_000;
const LOCK_WAIT_MS = 600;
const LOCK_RETRY_MS = 20;

const INDEX_KEY = 'review:live:index';
const LIVE_CHANNEL = 'review:live';
const sessionKey = (key: string): string => `review:live:s:${key}`;
const lockKey = (key: string): string => `review:live:lock:${key}`;

const mirror = new Map<string, StoredSession>();
const localMembership = new Map<string, Set<number>>();
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const graceKey = (key: string, userId: number): string => `${key}|${userId}`;
let wired = false;
let lastFailureLog = 0;

function warnRedis(err: unknown): void {
  const now = Date.now();
  if (now - lastFailureLog < 30_000) return;
  lastFailureLog = now;
  logger.warn({ err }, '[live] Redis indisponible : salles live dégradées');
}

/** Valid key: `media:<id>` or `playlist:<id>`. Returns its target, or null. */
export const parseLiveKey = (key: unknown): { type: 'media' | 'playlist'; id: number } | null => {
  if (typeof key !== 'string') return null;
  const m = /^(media|playlist):(\d+)$/.exec(key);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: m[1] as 'media' | 'playlist', id };
};

const toState = (key: string, s: StoredSession): LiveState => ({
  key,
  pilotId: s.pilotId,
  coHostIds: [...s.coHostIds],
  driverId: s.driverId,
  participants: s.participants.map((p) => p.p),
});

// ── Pure logic (unchanged: this is the observable behaviour of the room) ─────

/**
 * Removes a participant. If the pilot leaves, control passes to the first co-pilot, otherwise to the oldest
 * remaining participant; the session disappears when it empties. `changed: false` = the user was not there.
 */
export function removeParticipant(
  s: StoredSession,
  userId: number,
): { changed: boolean; session: StoredSession | null } {
  const index = s.participants.findIndex((p) => p.p.id === userId);
  if (index < 0) return { changed: false, session: s };
  s.participants.splice(index, 1);
  if (s.participants.length === 0) return { changed: true, session: null };

  s.coHostIds = s.coHostIds.filter((id) => id !== userId);
  if (s.pilotId === userId) s.pilotId = s.coHostIds[0] ?? s.participants[0]!.p.id;
  s.coHostIds = s.coHostIds.filter((id) => id !== s.pilotId);
  if (s.driverId === userId || !s.participants.some((p) => p.p.id === s.driverId)) s.driverId = s.pilotId;
  return { changed: true, session: s };
}

/** Removes the participants whose lease has expired (dead replica, ghost tab). */
export function pruneParticipants(s: StoredSession, now: number): StoredSession | null {
  let session: StoredSession | null = s;
  for (const expired of s.participants.filter((p) => p.e <= now)) {
    if (!session) break;
    session = removeParticipant(session, expired.p.id).session;
  }
  return session;
}

/** Defensive reading: a corrupted record counts as "no session". */
function readSession(raw: string | null): StoredSession | null {
  const s = parseJson<StoredSession>(raw);
  if (!s || !Array.isArray(s.participants) || typeof s.pilotId !== 'number') return null;
  if (!Array.isArray(s.coHostIds)) s.coHostIds = [];
  return s;
}

// ── Redis access ─────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Session lock. An unprotected read-modify-write would lose a participant as soon as two replicas touch the
 * same room. When the wait expires we carry on without the lock: better an
 * improbable race than a `live:join` that never answers.
 */
async function acquireLock(key: string): Promise<string | null> {
  const token = `${INSTANCE_ID}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const ok = await getRedis().call('SET', lockKey(key), token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok === 'OK') return token;
    if (Date.now() >= deadline) return null;
    await sleep(LOCK_RETRY_MS);
  }
}

async function releaseLock(key: string, token: string): Promise<void> {
  try {
    const redis = getRedis();
    if ((await redis.call('GET', lockKey(key))) === token) await redis.call('DEL', lockKey(key));
  } catch {
    /* the lock's lease expires by itself */
  }
}

async function loadSession(key: string): Promise<StoredSession | null> {
  const raw = await getRedis().call('GET', sessionKey(key));
  return readSession(typeof raw === 'string' ? raw : null);
}

async function saveSession(key: string, session: StoredSession | null): Promise<void> {
  const redis = getRedis();
  if (!session) {
    await redis.call('DEL', sessionKey(key));
    await redis.call('SREM', INDEX_KEY, key);
    return;
  }
  await redis.call('SET', sessionKey(key), JSON.stringify(session), 'PX', SESSION_TTL_MS);
  await redis.call('SADD', INDEX_KEY, key);
}

type Mutation<T> = (session: StoredSession | null) => { session: StoredSession | null; result: T };

/** Read-modify-write under lock, then local mirror and notification of the replicas. */
async function withSession<T>(key: string, mutate: Mutation<T>, fallback: T): Promise<T> {
  ensureWiring();
  let token: string | null = null;
  try {
    token = await acquireLock(key);
    const loaded = await loadSession(key);
    const pruned = loaded ? pruneParticipants(loaded, Date.now()) : null;
    const { session, result } = mutate(pruned);
    await saveSession(key, session);
    if (session) mirror.set(key, session);
    else mirror.delete(key);
    publishRedis(LIVE_CHANNEL, key);
    return result;
  } catch (err) {
    warnRedis(err);
    return fallback;
  } finally {
    if (token) await releaseLock(key, token);
  }
}

// ── Read mirror ──────────────────────────────────────────────────────────────

function ensureWiring(): void {
  if (wired) return;
  wired = true;
  subscribeRedis(LIVE_CHANNEL, (key) => void reloadOne(key));
  onHeartbeat(liveHeartbeat);
}

/**
 * Seeds the synchronisation at server start-up: the rooms opened elsewhere (or before the restart) must
 * appear in the LIVE badges without waiting for a client of this replica to join
 * a session.
 */
export function startLiveSync(): void {
  ensureWiring();
  void reloadAll().catch(warnRedis);
}

async function reloadOne(key: string): Promise<void> {
  try {
    const session = await loadSession(key);
    const pruned = session ? pruneParticipants(session, Date.now()) : null;
    if (pruned) mirror.set(key, pruned);
    else mirror.delete(key);
  } catch (err) {
    warnRedis(err);
  }
}

/** Full reconciliation: sessions of the other replicas, expired leases, lying index. */
async function reloadAll(): Promise<void> {
  const redis = getRedis();
  const keys = redisStrings(await redis.call('SMEMBERS', INDEX_KEY));
  const next = new Map<string, StoredSession>();
  const orphans: string[] = [];
  if (keys.length > 0) {
    const raws = redisNullableStrings(await redis.call('MGET', ...keys.map(sessionKey)));
    const now = Date.now();
    keys.forEach((key, i) => {
      const session = readSession(raws[i] ?? null);
      const pruned = session ? pruneParticipants(session, now) : null;
      if (pruned) next.set(key, pruned);
      else orphans.push(key);
    });
  }
  if (orphans.length > 0) {
    await redis.call('SREM', INDEX_KEY, ...orphans);
    for (const key of orphans) await redis.call('DEL', sessionKey(key));
  }
  mirror.clear();
  for (const [key, session] of next) mirror.set(key, session);
}

async function liveHeartbeat(): Promise<void> {
  const now = Date.now();
  for (const [key, userIds] of [...localMembership]) {
    if (userIds.size === 0) {
      localMembership.delete(key);
      continue;
    }
    await withSession<null>(
      key,
      (session) => {
        if (!session) return { session: null, result: null };
        for (const participant of session.participants)
          if (userIds.has(participant.p.id)) participant.e = now + LIVE_PARTICIPANT_TTL_MS;
        return { session, result: null };
      },
      null,
    );
  }
  await reloadAll();
}

function addMembership(key: string, userId: number): void {
  let set = localMembership.get(key);
  if (!set) {
    set = new Set();
    localMembership.set(key, set);
  }
  set.add(userId);
}

function dropMembership(key: string, userId: number): void {
  const set = localMembership.get(key);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) localMembership.delete(key);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Joins (or creates) the session; the first participant becomes pilot and driver.
 * `created` is **authoritative** (decided under lock): it is what decides to send the "live started"
 * notification, which must go out only once, whichever replica it is.
 */
export const joinLive = async (
  key: string,
  participant: LiveParticipant,
  meta?: LiveSessionMeta,
): Promise<{ state: LiveState; created: boolean }> => {
  addMembership(key, participant.id);
  const now = Date.now();
  const solo: StoredSession = {
    pilotId: participant.id,
    coHostIds: [],
    driverId: participant.id,
    participants: [{ p: participant, j: now, e: now + LIVE_PARTICIPANT_TTL_MS }],
    ...(meta ? { meta } : {}),
  };
  return withSession(
    key,
    (session) => {
      const created = !session;
      const s: StoredSession = session ?? {
        pilotId: participant.id,
        coHostIds: [],
        driverId: participant.id,
        participants: [],
      };
      if (meta && !s.meta) s.meta = meta;
      const existing = s.participants.find((p) => p.p.id === participant.id);
      if (existing) {
        existing.p = participant;
        existing.e = now + LIVE_PARTICIPANT_TTL_MS;
      } else {
        s.participants.push({ p: participant, j: now, e: now + LIVE_PARTICIPANT_TTL_MS });
      }
      return { session: s, result: { state: toState(key, s), created } };
    },
    { state: toState(key, mirror.get(key) ?? solo), created: false },
  );
};

/** Leaves the session. Returns the new state (null if closed or if the user was absent). */
export const leaveLive = async (key: string, userId: number): Promise<LiveState | null> => {
  dropMembership(key, userId);
  return withSession<LiveState | null>(
    key,
    (session) => {
      if (!session) return { session: null, result: null };
      const { changed, session: next } = removeParticipant(session, userId);
      if (!changed) return { session, result: null };
      return { session: next, result: next ? toState(key, next) : null };
    },
    null,
  );
};

/** Full handover: only the pilot can give control to a participant present. */
export const handoffLive = async (
  key: string,
  fromUserId: number,
  toUserId: number,
): Promise<LiveState | null> =>
  withSession<LiveState | null>(
    key,
    (session) => {
      if (
        !session ||
        session.pilotId !== fromUserId ||
        !session.participants.some((p) => p.p.id === toUserId) ||
        toUserId === fromUserId
      )
        return { session, result: null };
      session.pilotId = toUserId;
      session.coHostIds = session.coHostIds.filter((id) => id !== toUserId);
      session.driverId = toUserId;
      return { session, result: toState(key, session) };
    },
    null,
  );

/** Names/removes a co-pilot: pilot only, target present and different from the pilot. */
export const setCoHost = async (
  key: string,
  byUserId: number,
  targetUserId: number,
  isCoHost: boolean,
): Promise<LiveState | null> =>
  withSession<LiveState | null>(
    key,
    (session) => {
      if (
        !session ||
        session.pilotId !== byUserId ||
        !session.participants.some((p) => p.p.id === targetUserId) ||
        targetUserId === session.pilotId
      )
        return { session, result: null };
      if (isCoHost) {
        if (!session.coHostIds.includes(targetUserId)) session.coHostIds.push(targetUserId);
      } else {
        session.coHostIds = session.coHostIds.filter((id) => id !== targetUserId);
        if (session.driverId === targetUserId) session.driverId = session.pilotId;
      }
      return { session, result: toState(key, session) };
    },
    null,
  );

/** May broadcast: pilot or co-pilot (read from the mirror — hot path of `live:sync`). */
export const canDriveLive = (key: string, userId: number): boolean => {
  const s = mirror.get(key);
  return !!s && (s.pilotId === userId || s.coHostIds.includes(userId));
};

/** Is the current effective driver. */
export const isLiveDriver = (key: string, userId: number): boolean => mirror.get(key)?.driverId === userId;

/**
 * Takes effective control (interaction of a pilot/co-pilot). Returns the new state if the driver changes,
 * null otherwise (already driver, or not allowed).
 */
export const claimDrive = async (key: string, userId: number): Promise<LiveState | null> => {
  // Hot path: the periodic broadcast comes back here several times per second.
  const known = mirror.get(key);
  if (known && (known.driverId === userId || !canDriveLive(key, userId))) return null;
  return withSession<LiveState | null>(
    key,
    (session) => {
      if (
        !session ||
        session.driverId === userId ||
        !(session.pilotId === userId || session.coHostIds.includes(userId))
      )
        return { session, result: null };
      session.driverId = userId;
      return { session, result: toState(key, session) };
    },
    null,
  );
};

export const getLiveState = (key: string): LiveState | null => {
  const s = mirror.get(key);
  return s ? toState(key, s) : null;
};

/** Project owning the session (resolved at join) — null if the session is unknown or has no metadata. */
export const getLiveProjectId = (key: string): number | null => mirror.get(key)?.meta?.projectId ?? null;

/** Live sessions in progress for a project (LIVE badges: review, version cards, playlists). */
export const listLiveSessions = (projectId: number): LiveSessionSummary[] => {
  const out: LiveSessionSummary[] = [];
  for (const [key, s] of mirror) {
    if (s.meta?.projectId !== projectId) continue;
    out.push({
      key,
      ...s.meta,
      participantCount: s.participants.length,
      pilot: s.participants.find((p) => p.p.id === s.pilotId)?.p ?? null,
    });
  }
  return out;
};

/**
 * Deferred departure after a socket disconnection: the effective removal (and the loss of the pilot role)
 * only takes place after the grace period — a page reload (F5) re-joins
 * before and cancels via `cancelLiveLeave`. `onLeft` receives the resulting state (null if the session is
 * closed).
 */
export const scheduleLiveLeave = (
  key: string,
  userId: number,
  onLeft: (state: LiveState | null) => void,
  graceMs: number = LIVE_LEAVE_GRACE_MS,
): void => {
  cancelLiveLeave(key, userId);
  const k = graceKey(key, userId);
  graceTimers.set(
    k,
    setTimeout(() => {
      graceTimers.delete(k);
      void leaveLive(key, userId).then(onLeft);
    }, graceMs),
  );
};

/** Cancels a departure in grace (re-join after F5). True if a departure was indeed scheduled. */
export const cancelLiveLeave = (key: string, userId: number): boolean => {
  const k = graceKey(key, userId);
  const t = graceTimers.get(k);
  if (!t) return false;
  clearTimeout(t);
  graceTimers.delete(k);
  return true;
};

/** Reset of the local state (tests) — Redis is not touched. */
export const resetLiveSessions = (): void => {
  mirror.clear();
  localMembership.clear();
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear();
  wired = false;
  lastFailureLog = 0;
};

/** Test hooks: forced reconciliation without waiting for the heartbeat. */
export const __liveTesting = { reloadAll, liveHeartbeat, mirror };
