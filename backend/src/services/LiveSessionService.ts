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
 * Salle de review live (33.B) — état **partagé** (Redis) des sessions synchronisées.
 *
 * Une session est identifiée par une clé `media:<id>` ou `playlist:<id>` ; le premier
 * arrivant devient pilote, la main se passe explicitement, le dernier départ ferme la
 * session. Le pilote peut nommer des **co-pilotes** : parmi eux, le « driver » effectif
 * (celui dont la lecture fait foi) est le dernier à avoir interagi. Le RBAC (accès
 * projet) est vérifié par la couche socket avant tout join.
 *
 * L'état tenait dans une `Map` de process : une salle de dailies disparaissait à chaque
 * redémarrage du serveur, et se serait coupée en deux sur une seconde réplique. Il est
 * désormais dans Redis, sous **verrou par session** (lire-modifier-écrire concurrent),
 * chaque participant portant une échéance : une réplique tuée en pleine session ne laisse
 * pas ses participants dans la salle pour toujours.
 *
 * Les lectures restent **synchrones** : elles interrogent un miroir local, rafraîchi à
 * chaque mutation locale, à chaque notification d'une autre réplique, et au battement de
 * cœur. `listLiveSessions` est appelé depuis une route, `canDriveLive` sur le chemin
 * chaud de `live:sync` — ni l'un ni l'autre ne peut se permettre un aller-retour Redis.
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
  /** Pilote ou co-pilote dont la diffusion fait foi (dernier à avoir interagi). */
  driverId: number;
  participants: LiveParticipant[];
}

/** Cible résolue au join (RBAC) — permet de lister les sessions d'un projet (badges LIVE). */
export interface LiveSessionMeta {
  projectId: number;
  mediaId?: number;
  playlistId?: number;
  versionId?: number;
}

/** Session d'un projet vue de l'extérieur (badges sur review et cartes de version). */
export interface LiveSessionSummary extends LiveSessionMeta {
  key: string;
  participantCount: number;
  pilot: LiveParticipant | null;
}

/** Participant stocké : identité, arrivée (ordre), échéance du bail. */
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

/** Grâce avant le retrait effectif d'un participant déconnecté : un F5 garde son rôle. */
export const LIVE_LEAVE_GRACE_MS = 10_000;
/** Bail d'un participant : au-delà, la réplique qui le portait est présumée morte. */
export const LIVE_PARTICIPANT_TTL_MS = 90_000;
/** Bail de la session : filet de dernier recours si l'index venait à mentir. */
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

/** Clé valide : `media:<id>` ou `playlist:<id>`. Renvoie sa cible ou null. */
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

// ── Logique pure (inchangée : c'est le comportement observable de la salle) ───

/**
 * Retire un participant. Si le pilote part, la main passe au premier co-pilote sinon au
 * plus ancien participant restant ; la session disparaît quand elle se vide.
 * `changed: false` = l'utilisateur n'y était pas.
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

/** Retire les participants dont le bail a expiré (réplique morte, onglet fantôme). */
export function pruneParticipants(s: StoredSession, now: number): StoredSession | null {
  let session: StoredSession | null = s;
  for (const expired of s.participants.filter((p) => p.e <= now)) {
    if (!session) break;
    session = removeParticipant(session, expired.p.id).session;
  }
  return session;
}

/** Lecture défensive : un enregistrement corrompu vaut « pas de session ». */
function readSession(raw: string | null): StoredSession | null {
  const s = parseJson<StoredSession>(raw);
  if (!s || !Array.isArray(s.participants) || typeof s.pilotId !== 'number') return null;
  if (!Array.isArray(s.coHostIds)) s.coHostIds = [];
  return s;
}

// ── Accès Redis ──────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verrou de session. Un lire-modifier-écrire non protégé perdrait un participant dès que
 * deux répliques touchent la même salle. À l'expiration de l'attente on continue sans
 * verrou : mieux vaut une course improbable qu'un `live:join` qui ne répond jamais.
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
    /* le bail du verrou expire de lui-même */
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

/** Lire-modifier-écrire sous verrou, puis miroir local et notification des répliques. */
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

// ── Miroir de lecture ────────────────────────────────────────────────────────

function ensureWiring(): void {
  if (wired) return;
  wired = true;
  subscribeRedis(LIVE_CHANNEL, (key) => void reloadOne(key));
  onHeartbeat(liveHeartbeat);
}

/**
 * Amorce la synchronisation au démarrage du serveur : les salles ouvertes ailleurs (ou
 * avant le redémarrage) doivent apparaître dans les badges LIVE sans attendre qu'un
 * client de cette réplique-ci rejoigne une session.
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

/** Réconciliation complète : sessions des autres répliques, baux échus, index menteur. */
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

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Rejoint (ou crée) la session ; le premier participant devient pilote et driver.
 * `created` est **autoritatif** (décidé sous verrou) : c'est lui qui décide d'envoyer la
 * notification « live démarré », qui ne doit partir qu'une fois, quelle que soit la réplique.
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

/** Quitte la session. Renvoie le nouvel état (null si fermée ou si l'utilisateur était absent). */
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

/** Passage de main complet : seul le pilote peut donner le pilotage à un participant présent. */
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

/** Nomme/retire un co-pilote : pilote seulement, cible présente et différente du pilote. */
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

/** Peut diffuser : pilote ou co-pilote (lecture du miroir — chemin chaud de `live:sync`). */
export const canDriveLive = (key: string, userId: number): boolean => {
  const s = mirror.get(key);
  return !!s && (s.pilotId === userId || s.coHostIds.includes(userId));
};

/** Est le driver effectif courant. */
export const isLiveDriver = (key: string, userId: number): boolean => mirror.get(key)?.driverId === userId;

/**
 * Prend la main effective (interaction d'un pilote/co-pilote). Renvoie le nouvel état
 * si le driver change, null sinon (déjà driver, ou non autorisé).
 */
export const claimDrive = async (key: string, userId: number): Promise<LiveState | null> => {
  // Chemin chaud : la diffusion périodique repasse ici plusieurs fois par seconde.
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

/** Projet porteur de la session (résolu au join) — null si session inconnue ou sans méta. */
export const getLiveProjectId = (key: string): number | null => mirror.get(key)?.meta?.projectId ?? null;

/** Sessions live en cours d'un projet (badges LIVE : review, cartes de version, playlists). */
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
 * Départ différé après déconnexion socket : le retrait effectif (et la perte du rôle de
 * pilote) n'a lieu qu'après la grâce — un rechargement de page (F5) re-join avant et
 * annule via `cancelLiveLeave`. `onLeft` reçoit l'état résultant (null si session fermée).
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

/** Annule un départ en grâce (re-join après F5). Vrai si un départ était bien programmé. */
export const cancelLiveLeave = (key: string, userId: number): boolean => {
  const k = graceKey(key, userId);
  const t = graceTimers.get(k);
  if (!t) return false;
  clearTimeout(t);
  graceTimers.delete(k);
  return true;
};

/** Réinitialisation de l'état local (tests) — Redis n'est pas touché. */
export const resetLiveSessions = (): void => {
  mirror.clear();
  localMembership.clear();
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear();
  wired = false;
  lastFailureLog = 0;
};

/** Crochets de test : réconciliation forcée sans attendre le battement de cœur. */
export const __liveTesting = { reloadAll, liveHeartbeat, mirror };
