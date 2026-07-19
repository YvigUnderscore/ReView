import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSocket } from '../../../lib/socket';
import { reviewPath } from '../../lib/slug';
import { useAuth } from '../../stores/useAuth';

/** Participant d'une session live (payload socket `live:state`). */
export interface LiveParticipant {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}
export interface LiveStatePayload {
  key: string;
  pilotId: number;
  participants: LiveParticipant[];
}
/** État diffusé par le pilote (~2 Hz) — appliqué tel quel par les spectateurs. */
interface LiveSyncPayload {
  mediaId: number;
  t?: number;
  playing?: boolean;
  camera?: unknown;
}

export interface LiveSession {
  /** En session (rejointe et non quittée). */
  active: boolean;
  isPilot: boolean;
  pilotId: number | null;
  participants: LiveParticipant[];
  join: () => void;
  leave: () => void;
  handoff: (toUserId: number) => void;
}

/**
 * Départs différés par clé de session : la navigation interne (média suivant d'une
 * playlist) démonte puis remonte le hook — on n'émet `live:leave` que si aucun
 * nouveau montage n'a repris la session entre-temps (sinon le pilote perdrait la main).
 */
const pendingLeaves = new Map<string, number>();
const cancelPendingLeave = (key: string) => {
  const t = pendingLeaves.get(key);
  if (t !== undefined) {
    window.clearTimeout(t);
    pendingLeaves.delete(key);
  }
};
const schedulePendingLeave = (key: string) => {
  cancelPendingLeave(key);
  pendingLeaves.set(
    key,
    window.setTimeout(() => {
      pendingLeaves.delete(key);
      getSocket().emit('live:leave', key);
    }, 1500),
  );
};

/**
 * Salle de review live (33.B). Session identifiée par `playlist:<id>` (si la review
 * est ouverte avec `?playlist=`) sinon `media:<id>`. Le pilote diffuse média courant,
 * playhead/pause et caméra 3D ; les spectateurs appliquent (navigation auto comprise).
 * `?live=1` dans l'URL fait rejoindre automatiquement (suivi de navigation).
 */
export function useLiveSession({
  mediaId,
  kind,
  videoRef,
  programmaticSeekRef,
  captureCamera,
  restoreCamera,
}: {
  mediaId: number;
  kind: string | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: React.MutableRefObject<boolean>;
  captureCamera: () => unknown;
  restoreCamera: (camera: unknown) => void;
}): LiveSession {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selfId = useAuth((s) => s.user?.id) ?? 0;
  const playlistId = Number(searchParams.get('playlist')) || 0;
  const key = playlistId > 0 ? `playlist:${playlistId}` : `media:${mediaId}`;
  const wantLive = searchParams.get('live') === '1';

  const [state, setState] = useState<LiveStatePayload | null>(null);
  // `?live=1` à l'arrivée = session déjà rejointe (navigation pilotée) → actif d'emblée.
  const [active, setActive] = useState(() => wantLive);
  const isPilot = active && state?.pilotId === selfId;
  // Refs miroir pour les callbacks socket/intervalles (pas de re-abonnement par tick).
  const is3d = kind === 'MODEL_3D' || kind === 'SPLAT';
  const applyRef = useRef({ mediaId, is3d, restoreCamera, captureCamera });
  useEffect(() => {
    applyRef.current = { mediaId, is3d, restoreCamera, captureCamera };
  }, [mediaId, is3d, restoreCamera, captureCamera]);

  const setLiveParam = useCallback(
    (on: boolean) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (on) next.set('live', '1');
          else next.delete('live');
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const join = useCallback(() => {
    cancelPendingLeave(key);
    getSocket().emit('live:join', key);
    setActive(true);
    setLiveParam(true);
  }, [key, setLiveParam]);

  const leave = useCallback(() => {
    cancelPendingLeave(key);
    getSocket().emit('live:leave', key);
    setActive(false);
    setState(null);
    setLiveParam(false);
  }, [key, setLiveParam]);

  const handoff = useCallback((toUserId: number) => getSocket().emit('live:handoff', key, toUserId), [key]);

  // Abonnement à l'état de la session + auto-join si l'URL porte ?live=1.
  useEffect(() => {
    const socket = getSocket();
    const onState = (data: { key: string; state: LiveStatePayload | null }) => {
      if (data.key !== key) return;
      setState(data.state);
    };
    const rejoin = () => socket.emit('live:join', key);
    socket.on('live:state', onState);
    if (wantLive) {
      cancelPendingLeave(key);
      socket.emit('live:join', key);
      socket.on('connect', rejoin);
    }
    return () => {
      socket.off('live:state', onState);
      socket.off('connect', rejoin);
      // Départ différé : annulé si la review suivante (même session) remonte aussitôt.
      if (wantLive) schedulePendingLeave(key);
    };
  }, [key, wantLive]);

  // Spectateur : applique l'état du pilote (navigation, playhead, lecture, caméra).
  useEffect(() => {
    if (!active || isPilot) return;
    const socket = getSocket();
    const onSync = (data: { key: string; payload: LiveSyncPayload }) => {
      if (data.key !== key) return;
      const { payload } = data;
      const cur = applyRef.current;
      if (payload.mediaId !== cur.mediaId) {
        const carry = new URLSearchParams();
        if (playlistId > 0) carry.set('playlist', String(playlistId));
        carry.set('live', '1');
        navigate(`${reviewPath({ id: payload.mediaId })}?${carry.toString()}`);
        return;
      }
      const video = videoRef.current;
      if (video && payload.t !== undefined) {
        if (Math.abs(video.currentTime - payload.t) > 0.5) {
          programmaticSeekRef.current = true;
          video.currentTime = payload.t;
        }
        if (payload.playing === true && video.paused) void video.play().catch(() => undefined);
        else if (payload.playing === false && !video.paused) video.pause();
      }
      if (payload.camera !== undefined && cur.is3d) cur.restoreCamera(payload.camera);
    };
    socket.on('live:sync', onSync);
    return () => {
      socket.off('live:sync', onSync);
    };
  }, [active, isPilot, key, playlistId, navigate, videoRef, programmaticSeekRef]);

  // Pilote : diffuse l'état courant à ~2 Hz (suffisant pour des dailies ; payload léger).
  useEffect(() => {
    if (!isPilot) return;
    const socket = getSocket();
    const tick = () => {
      const cur = applyRef.current;
      const video = videoRef.current;
      const payload: LiveSyncPayload = { mediaId: cur.mediaId };
      if (video) {
        payload.t = video.currentTime;
        payload.playing = !video.paused;
      }
      if (cur.is3d) payload.camera = cur.captureCamera();
      socket.emit('live:sync', key, payload);
    };
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [isPilot, key, videoRef]);

  return {
    active,
    isPilot,
    pilotId: state?.pilotId ?? null,
    participants: state?.participants ?? [],
    join,
    leave,
    handoff,
  };
}
