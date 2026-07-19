import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSocket } from '../../../lib/socket';
import { reviewPath } from '../../lib/slug';
import { useAuth } from '../../stores/useAuth';
import type { ImageViewApi } from '../../components/ImageReviewViewer';
import {
  cancelPendingLeave,
  driverMedia,
  schedulePendingLeave,
  type LiveParticipant,
  type LiveStatePayload,
  type LiveSyncPayload,
} from './liveSync';

export type { LiveParticipant, LiveStatePayload } from './liveSync';

export interface LiveSession {
  /** Clé de la session courante (`media:<id>` ou `playlist:<id>`) — badges LIVE. */
  key: string;
  /** En session (rejointe et non quittée). */
  active: boolean;
  isPilot: boolean;
  /** Diffusion en cours (pilote ou co-pilote driver). */
  isDriver: boolean;
  pilotId: number | null;
  coHostIds: number[];
  driverId: number | null;
  participants: LiveParticipant[];
  /** Lecture démarrée en sourdine (autoplay bloqué) : proposer d'activer le son. */
  needsUnmute: boolean;
  unmute: () => void;
  join: () => void;
  leave: () => void;
  handoff: (toUserId: number) => void;
  setCoHost: (toUserId: number, isCoHost: boolean) => void;
  /** Interaction locale d'un co-pilote (clic viewer, zoom…) → prise de main immédiate. */
  claimInteraction: () => void;
}

/**
 * Salle de review live (33.B + retours CP-HUMAIN). Session identifiée par
 * `playlist:<id>` (si `?playlist=`) sinon `media:<id>`. Le **driver** (pilote ou
 * co-pilote ayant interagi en dernier) diffuse à `syncHz` : média courant,
 * playhead/pause, caméra 3D/splat (DoF inclus), comparaison A/B, zoom/pan image.
 * Les spectateurs appliquent tout ; `?live=1` fait rejoindre automatiquement.
 */
export function useLiveSession({
  mediaId,
  kind,
  fps,
  syncHz,
  videoRef,
  programmaticSeekRef,
  captureCamera,
  restoreCamera,
  compareId,
  onCompareChange,
  compareMode,
  onCompareModeChange,
  wipe,
  onWipeApply,
  imageViewApiRef,
}: {
  mediaId: number;
  kind: string | undefined;
  fps: number;
  syncHz: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: React.MutableRefObject<boolean>;
  captureCamera: () => unknown;
  restoreCamera: (camera: unknown) => void;
  compareId: number | null;
  onCompareChange: (id: number | null) => void;
  /** Mode de comparaison + barre de wipe — diffusés par le driver (retours 33). */
  compareMode: 'side' | 'wipe';
  onCompareModeChange: (mode: 'side' | 'wipe') => void;
  wipe: { pos: number; angle: number };
  onWipeApply: (pos: number, angle: number) => void;
  imageViewApiRef: React.MutableRefObject<ImageViewApi | null>;
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
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const isPilot = active && state?.pilotId === selfId;
  const canDrive = active && (isPilot || (state?.coHostIds ?? []).includes(selfId));
  const isDriver = active && state?.driverId === selfId;
  // Application d'une sync en cours : les événements vidéo qui en découlent ne sont
  // pas des interactions locales (un co-pilote ne doit pas voler la main en suivant).
  const applyingRef = useRef(false);
  // Refs miroir pour les callbacks socket/intervalles (pas de re-abonnement par tick) :
  // recopiées après chaque render (l'effet sans dépendances court à chaque commit).
  const is3d = kind === 'MODEL_3D' || kind === 'SPLAT';
  const mirror = {
    mediaId,
    is3d,
    kind,
    restoreCamera,
    captureCamera,
    compareId,
    onCompareChange,
    compareMode,
    onCompareModeChange,
    wipe,
    onWipeApply,
  };
  const applyRef = useRef(mirror);
  useEffect(() => {
    applyRef.current = mirror;
  });

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

  /** Compose l'état courant à diffuser (driver). */
  const buildPayload = useCallback(
    (action?: boolean): LiveSyncPayload => {
      const cur = applyRef.current;
      const payload: LiveSyncPayload = { mediaId: cur.mediaId };
      if (action) payload.action = true;
      const video = videoRef.current;
      if (video) {
        payload.t = video.currentTime;
        payload.playing = !video.paused;
      }
      if (cur.is3d) payload.camera = cur.captureCamera();
      if (cur.kind === 'VIDEO' || cur.kind === 'IMAGE') {
        payload.compareId = cur.compareId;
        // Comparaison active : le mode (côte-à-côte/wipe) et la barre suivent le driver.
        if (cur.compareId != null) {
          payload.compareMode = cur.compareMode;
          if (cur.compareMode === 'wipe') payload.wipe = cur.wipe;
        }
      }
      if (cur.kind === 'IMAGE') {
        const view = imageViewApiRef.current?.capture();
        if (view) payload.imageView = view;
      }
      return payload;
    },
    [videoRef, imageViewApiRef],
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
    setNeedsUnmute(false);
    setLiveParam(false);
  }, [key, setLiveParam]);

  const handoff = useCallback((toUserId: number) => getSocket().emit('live:handoff', key, toUserId), [key]);
  const setCoHost = useCallback(
    (toUserId: number, isCoHost: boolean) => getSocket().emit('live:cohost', key, toUserId, isCoHost),
    [key],
  );

  /** Interaction locale d'un pilote/co-pilote : sync immédiate marquée `action`. */
  const claimInteraction = useCallback(() => {
    // Déjà driver : la diffusion périodique suffit (évite un spam d'émissions pendant
    // un drag continu — wipe, zoom). Le claim ne sert qu'à prendre la main.
    if (!canDrive || isDriver || applyingRef.current) return;
    getSocket().emit('live:sync', key, buildPayload(true));
  }, [canDrive, isDriver, key, buildPayload]);

  const unmute = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = false;
    setNeedsUnmute(false);
  }, [videoRef]);

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

  // Navigation locale d'un co-pilote (≠ suivi du driver) → prise de main immédiate.
  useEffect(() => {
    if (!canDrive || isDriver || driverMedia.lastId === 0 || driverMedia.lastId === mediaId) return;
    claimInteraction();
    // Volontairement dépendant du seul montage/état : une navigation = un claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDrive, isDriver, mediaId]);

  // Spectateur (et co-pilote non-driver) : applique l'état du driver.
  useEffect(() => {
    if (!active || isDriver) return;
    const socket = getSocket();
    const onSync = (data: { key: string; payload: LiveSyncPayload }) => {
      if (data.key !== key) return;
      const { payload } = data;
      const cur = applyRef.current;
      applyingRef.current = true;
      try {
        if (payload.mediaId !== cur.mediaId) {
          driverMedia.lastId = payload.mediaId;
          const carry = new URLSearchParams();
          if (playlistId > 0) carry.set('playlist', String(playlistId));
          carry.set('live', '1');
          navigate(`${reviewPath({ id: payload.mediaId })}?${carry.toString()}`);
          return;
        }
        driverMedia.lastId = payload.mediaId;
        const video = videoRef.current;
        if (video && payload.t !== undefined) {
          // Recalage : à la frame près en pause (les frames doivent être alignées),
          // avec tolérance en lecture (éviter les à-coups).
          const drift = Math.abs(video.currentTime - payload.t);
          const threshold = payload.playing ? 0.35 : 1 / (fps || 24) / 2 + 0.001;
          if (drift > threshold) {
            programmaticSeekRef.current = true;
            video.currentTime = payload.t;
          }
          if (payload.playing === true && video.paused) {
            // Autoplay sans interaction préalable : replier sur une lecture en sourdine
            // (autorisée par les navigateurs) et proposer d'activer le son.
            void video.play().catch(() => {
              video.muted = true;
              setNeedsUnmute(true);
              void video.play().catch(() => undefined);
            });
          } else if (payload.playing === false && !video.paused) video.pause();
        }
        if (payload.camera !== undefined && cur.is3d) cur.restoreCamera(payload.camera);
        if (payload.compareId !== undefined && payload.compareId !== cur.compareId)
          cur.onCompareChange(payload.compareId);
        if (payload.compareMode !== undefined && payload.compareMode !== cur.compareMode)
          cur.onCompareModeChange(payload.compareMode);
        if (payload.wipe && (payload.wipe.pos !== cur.wipe.pos || payload.wipe.angle !== cur.wipe.angle))
          cur.onWipeApply(payload.wipe.pos, payload.wipe.angle);
        if (payload.imageView && cur.kind === 'IMAGE') imageViewApiRef.current?.apply(payload.imageView);
      } finally {
        // Reset différé : les événements play/pause/seeked découlant de l'application
        // arrivent après ce handler (même tick ou tâche suivante).
        setTimeout(() => {
          applyingRef.current = false;
        }, 0);
      }
    };
    socket.on('live:sync', onSync);
    return () => {
      socket.off('live:sync', onSync);
    };
  }, [active, isDriver, key, playlistId, fps, navigate, videoRef, programmaticSeekRef, imageViewApiRef]);

  // Co-pilote non-driver : une commande vidéo locale (play/pause/seek) prend la main.
  useEffect(() => {
    if (!canDrive || isDriver) return;
    const video = videoRef.current;
    if (!video) return;
    const onLocalCommand = () => {
      if (applyingRef.current || programmaticSeekRef.current) return;
      claimInteraction();
    };
    video.addEventListener('play', onLocalCommand);
    video.addEventListener('pause', onLocalCommand);
    video.addEventListener('seeked', onLocalCommand);
    return () => {
      video.removeEventListener('play', onLocalCommand);
      video.removeEventListener('pause', onLocalCommand);
      video.removeEventListener('seeked', onLocalCommand);
    };
  }, [canDrive, isDriver, videoRef, programmaticSeekRef, claimInteraction]);

  // Co-pilote non-driver : un clic dans un viewer 3D/splat (canvas) prend la main.
  useEffect(() => {
    if (!canDrive || isDriver || !applyRef.current.is3d) return;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('canvas')) claimInteraction();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [canDrive, isDriver, claimInteraction]);

  // Driver : diffuse l'état courant à `syncHz` (réglable admin par type de média).
  useEffect(() => {
    if (!isDriver) return;
    const socket = getSocket();
    const tick = () => socket.emit('live:sync', key, buildPayload());
    tick();
    const interval = window.setInterval(tick, Math.round(1000 / Math.min(30, Math.max(1, syncHz))));
    return () => window.clearInterval(interval);
  }, [isDriver, key, syncHz, buildPayload]);

  return {
    key,
    active,
    isPilot,
    isDriver,
    pilotId: state?.pilotId ?? null,
    coHostIds: state?.coHostIds ?? [],
    driverId: state?.driverId ?? null,
    participants: state?.participants ?? [],
    needsUnmute,
    unmute,
    join,
    leave,
    handoff,
    setCoHost,
    claimInteraction,
  };
}
