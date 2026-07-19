/**
 * Salle de review live (33.B) — état **en mémoire** des sessions synchronisées.
 * Une session est identifiée par une clé `media:<id>` ou `playlist:<id>` ; le premier
 * arrivant devient pilote, la main se passe explicitement, le dernier départ ferme la
 * session. Le RBAC (accès projet) est vérifié par la couche socket avant tout join.
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
  participants: LiveParticipant[];
}

interface Session {
  pilotId: number;
  participants: Map<number, LiveParticipant>;
}

const sessions = new Map<string, Session>();

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
  participants: [...s.participants.values()],
});

/** Rejoint (ou crée) la session ; le premier participant devient pilote. */
export const joinLive = (key: string, participant: LiveParticipant): LiveState => {
  let s = sessions.get(key);
  if (!s) {
    s = { pilotId: participant.id, participants: new Map() };
    sessions.set(key, s);
  }
  s.participants.set(participant.id, participant);
  return toState(key, s);
};

/**
 * Quitte la session. Si le pilote part, la main passe au plus ancien participant
 * restant ; la session disparaît quand elle se vide. Renvoie le nouvel état (null
 * si la session est fermée ou si l'utilisateur n'y était pas).
 */
export const leaveLive = (key: string, userId: number): LiveState | null => {
  const s = sessions.get(key);
  if (!s || !s.participants.delete(userId)) return null;
  if (s.participants.size === 0) {
    sessions.delete(key);
    return null;
  }
  if (s.pilotId === userId) s.pilotId = s.participants.keys().next().value!;
  return toState(key, s);
};

/** Passage de main : seul le pilote peut donner la main à un participant présent. */
export const handoffLive = (key: string, fromUserId: number, toUserId: number): LiveState | null => {
  const s = sessions.get(key);
  if (!s || s.pilotId !== fromUserId || !s.participants.has(toUserId)) return null;
  s.pilotId = toUserId;
  return toState(key, s);
};

export const isLivePilot = (key: string, userId: number): boolean => sessions.get(key)?.pilotId === userId;

export const getLiveState = (key: string): LiveState | null => {
  const s = sessions.get(key);
  return s ? toState(key, s) : null;
};

/** Réinitialisation complète (tests). */
export const resetLiveSessions = (): void => sessions.clear();
