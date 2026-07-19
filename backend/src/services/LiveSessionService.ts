/**
 * Salle de review live (33.B) — état **en mémoire** des sessions synchronisées.
 * Une session est identifiée par une clé `media:<id>` ou `playlist:<id>` ; le premier
 * arrivant devient pilote, la main se passe explicitement, le dernier départ ferme la
 * session. Le pilote peut nommer des **co-pilotes** : parmi eux, le « driver » effectif
 * (celui dont la lecture fait foi) est le dernier à avoir interagi. Le RBAC (accès
 * projet) est vérifié par la couche socket avant tout join.
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

interface Session {
  pilotId: number;
  coHostIds: Set<number>;
  driverId: number;
  participants: Map<number, LiveParticipant>;
  meta?: LiveSessionMeta;
}

const sessions = new Map<string, Session>();

/** Grâce avant le retrait effectif d'un participant déconnecté : un F5 garde son rôle. */
export const LIVE_LEAVE_GRACE_MS = 10_000;
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const graceKey = (key: string, userId: number) => `${key}|${userId}`;

/** Clé valide : `media:<id>` ou `playlist:<id>`. Renvoie sa cible ou null. */
export const parseLiveKey = (key: unknown): { type: 'media' | 'playlist'; id: number } | null => {
  if (typeof key !== 'string') return null;
  const m = /^(media|playlist):(\d+)$/.exec(key);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: m[1] as 'media' | 'playlist', id };
};

const toState = (key: string, s: Session): LiveState => ({
  key,
  pilotId: s.pilotId,
  coHostIds: [...s.coHostIds],
  driverId: s.driverId,
  participants: [...s.participants.values()],
});

/** Rejoint (ou crée) la session ; le premier participant devient pilote et driver. */
export const joinLive = (key: string, participant: LiveParticipant, meta?: LiveSessionMeta): LiveState => {
  let s = sessions.get(key);
  if (!s) {
    s = { pilotId: participant.id, coHostIds: new Set(), driverId: participant.id, participants: new Map() };
    sessions.set(key, s);
  }
  if (meta && !s.meta) s.meta = meta;
  s.participants.set(participant.id, participant);
  return toState(key, s);
};

/**
 * Quitte la session. Si le pilote part, la main passe au premier co-pilote sinon au
 * plus ancien participant restant ; la session disparaît quand elle se vide. Renvoie
 * le nouvel état (null si la session est fermée ou si l'utilisateur n'y était pas).
 */
export const leaveLive = (key: string, userId: number): LiveState | null => {
  const s = sessions.get(key);
  if (!s || !s.participants.delete(userId)) return null;
  if (s.participants.size === 0) {
    sessions.delete(key);
    return null;
  }
  s.coHostIds.delete(userId);
  if (s.pilotId === userId)
    s.pilotId = s.coHostIds.values().next().value ?? s.participants.keys().next().value!;
  s.coHostIds.delete(s.pilotId);
  if (s.driverId === userId || !s.participants.has(s.driverId)) s.driverId = s.pilotId;
  return toState(key, s);
};

/** Passage de main complet : seul le pilote peut donner le pilotage à un participant présent. */
export const handoffLive = (key: string, fromUserId: number, toUserId: number): LiveState | null => {
  const s = sessions.get(key);
  if (!s || s.pilotId !== fromUserId || !s.participants.has(toUserId) || toUserId === fromUserId) return null;
  s.pilotId = toUserId;
  s.coHostIds.delete(toUserId);
  s.driverId = toUserId;
  return toState(key, s);
};

/** Nomme/retire un co-pilote : pilote seulement, cible présente et différente du pilote. */
export const setCoHost = (
  key: string,
  byUserId: number,
  targetUserId: number,
  isCoHost: boolean,
): LiveState | null => {
  const s = sessions.get(key);
  if (!s || s.pilotId !== byUserId || !s.participants.has(targetUserId) || targetUserId === s.pilotId)
    return null;
  if (isCoHost) s.coHostIds.add(targetUserId);
  else {
    s.coHostIds.delete(targetUserId);
    if (s.driverId === targetUserId) s.driverId = s.pilotId;
  }
  return toState(key, s);
};

/** Peut diffuser : pilote ou co-pilote. */
export const canDriveLive = (key: string, userId: number): boolean => {
  const s = sessions.get(key);
  return !!s && (s.pilotId === userId || s.coHostIds.has(userId));
};

/** Est le driver effectif courant. */
export const isLiveDriver = (key: string, userId: number): boolean => sessions.get(key)?.driverId === userId;

/**
 * Prend la main effective (interaction d'un pilote/co-pilote). Renvoie le nouvel état
 * si le driver change, null sinon (déjà driver, ou non autorisé).
 */
export const claimDrive = (key: string, userId: number): LiveState | null => {
  const s = sessions.get(key);
  if (!s || s.driverId === userId || !canDriveLive(key, userId)) return null;
  s.driverId = userId;
  return toState(key, s);
};

export const getLiveState = (key: string): LiveState | null => {
  const s = sessions.get(key);
  return s ? toState(key, s) : null;
};

/** Projet porteur de la session (résolu au join) — null si session inconnue ou sans méta. */
export const getLiveProjectId = (key: string): number | null => sessions.get(key)?.meta?.projectId ?? null;

/** Sessions live en cours d'un projet (badges LIVE : review, cartes de version, playlists). */
export const listLiveSessions = (projectId: number): LiveSessionSummary[] => {
  const out: LiveSessionSummary[] = [];
  for (const [key, s] of sessions) {
    if (s.meta?.projectId !== projectId) continue;
    out.push({
      key,
      ...s.meta,
      participantCount: s.participants.size,
      pilot: s.participants.get(s.pilotId) ?? null,
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
      onLeft(leaveLive(key, userId));
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

/** Réinitialisation complète (tests). */
export const resetLiveSessions = (): void => {
  sessions.clear();
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear();
};
