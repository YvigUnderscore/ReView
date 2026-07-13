import { useCallback, useEffect, useRef, useState } from 'react';
import type { SplatCamera } from '../reviewTypes';
import { FLY_MOVE_MAPPING } from '../viewer/flyControls';
import {
  animDuration,
  animKeyTimes,
  deleteColumn,
  deleteKey,
  emptyAnim,
  hasAnimation as animHasAnimation,
  moveColumn,
  moveKey,
  setKeyMode,
  setKeyTangent,
  upsertKey,
  upsertPoseAt,
  type CameraAnimV2,
  type ChannelId,
  type TangentMode,
} from './channels/model';
import { sampleAnimV2 } from './channels/hermite';

/**
 * Contrôleur caméra minimal requis par le lecteur/éditeur d'animation — commun **3D et splat** :
 * boucle de rendu, application/capture de pose, canvas (auto-pause au moindre input).
 */
export interface CameraController {
  subscribeFrame(cb: (dt: number) => void): () => void;
  restoreCamera(state: unknown): void;
  captureCamera(): SplatCamera | undefined;
  getDom(): HTMLElement | null;
}

const HISTORY_LIMIT = 100;

/**
 * Lecteur + éditeur d'animation caméra par F-curves (Phase 17, v2) : transport (play/pause/scrub,
 * boucle), échantillonnage Hermite par frame, **reprise en main auto** (tout input met en pause),
 * édition des clés (poser depuis la vue, déplacer temps/valeur, tangentes, modes, colonnes) et
 * undo/redo local. Remplace `useCameraKeyframes`. La lecture s'appuie sur `subscribeFrame`.
 */
export function useCameraAnim(controller: CameraController) {
  const { subscribeFrame, restoreCamera, captureCamera, getDom } = controller;
  const [anim, setAnimState] = useState<CameraAnimV2>(() => emptyAnim());
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  // Sélection de clés (dopesheet/graph) — { channel, index }.
  const [selection, setSelection] = useState<{ channel: ChannelId; index: number } | null>(null);
  const [past, setPast] = useState<CameraAnimV2[]>([]);
  const [future, setFuture] = useState<CameraAnimV2[]>([]);

  const timeRef = useRef(0);
  const lastUi = useRef(0);
  const animRef = useRef(anim);
  const baseRef = useRef<SplatCamera>({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
  useEffect(() => {
    animRef.current = anim;
  }, [anim]);

  // ── Édition avec historique : chaque mutation empile l'état courant (undo). ──
  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), animRef.current]);
    setFuture([]);
  }, []);
  const commit = useCallback(
    (next: CameraAnimV2) => {
      pushHistory();
      setAnimState(next);
    },
    [pushHistory],
  );
  // Geste continu (drag d'une clé/tangente) : un seul snapshot au début, puis mises à jour live
  // sans empiler — un undo annule tout le geste.
  const beginStroke = useCallback(() => pushHistory(), [pushHistory]);
  const strokeMoveKey = useCallback(
    (channel: ChannelId, index: number, patch: { t?: number; v?: number }) =>
      setAnimState(moveKey(animRef.current, channel, index, patch)),
    [],
  );
  const strokeSetTangent = useCallback(
    (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) =>
      setAnimState(setKeyTangent(animRef.current, channel, index, patch)),
    [],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [animRef.current, ...f]);
      setAnimState(prev);
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, animRef.current]);
      setAnimState(next);
      return f.slice(1);
    });
  }, []);

  // Remplace toute l'animation (présentation persistée, preset, import) — capture la pose de base.
  const setAnim = useCallback(
    (next: CameraAnimV2) => {
      timeRef.current = 0;
      setTimeMs(0);
      setPast([]);
      setFuture([]);
      const view = captureCamera();
      if (view) baseRef.current = view;
      setAnimState(next);
    },
    [captureCamera],
  );

  const setLoop = useCallback((loop: boolean) => commit({ ...animRef.current, loop }), [commit]);

  // Boucle de lecture : avance le temps, échantillonne la pose, l'applique à la caméra.
  useEffect(() => {
    if (!playing) return;
    return subscribeFrame((dt) => {
      timeRef.current += dt * 1000;
      const a = animRef.current;
      restoreCamera(sampleAnimV2(a, timeRef.current, baseRef.current));
      const duration = animDuration(a);
      if (!a.loop && timeRef.current >= duration) setPlaying(false);
      const now = performance.now();
      if (now - lastUi.current > 100) {
        lastUi.current = now;
        setTimeMs(a.loop ? timeRef.current % Math.max(duration, 1) : timeRef.current);
      }
    });
  }, [playing, subscribeFrame, restoreCamera]);

  // Reprise en main automatique : orbite/molette/vol pendant la lecture → pause.
  useEffect(() => {
    if (!playing) return;
    const dom = getDom();
    if (!dom) return;
    const pause = () => {
      setPlaying(false);
      setAutoPaused(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code in FLY_MOVE_MAPPING) pause();
    };
    dom.addEventListener('pointerdown', pause);
    dom.addEventListener('wheel', pause, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      dom.removeEventListener('pointerdown', pause);
      dom.removeEventListener('wheel', pause);
      window.removeEventListener('keydown', onKey);
    };
  }, [playing, getDom]);

  const play = useCallback(() => {
    setAutoPaused(false);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    setPlaying(false);
    setAutoPaused(false);
  }, []);

  /** Positionne la lecture (et la caméra) à `t` ms — scrub/playhead. */
  const scrub = useCallback(
    (t: number) => {
      timeRef.current = t;
      setTimeMs(t);
      restoreCamera(sampleAnimV2(animRef.current, t, baseRef.current));
    },
    [restoreCamera],
  );

  /** Pose une clé sur tous les canaux au temps `t` (défaut : fin de la lecture), depuis la vue. */
  const insertKeyAtView = useCallback(
    (t?: number) => {
      const view = captureCamera();
      if (!view) return;
      const time = t != null ? Math.max(0, Math.round(t)) : Math.round(timeRef.current);
      if (!hasAnimationRef(animRef.current)) baseRef.current = view;
      commit(upsertPoseAt(animRef.current, time, view));
    },
    [captureCamera, commit],
  );

  /** Ajoute une clé sur un canal précis (double-clic sur une courbe du graph editor). */
  const addKey = useCallback(
    (channel: ChannelId, t: number, v: number) =>
      commit(upsertKey(animRef.current, channel, Math.max(0, t), v)),
    [commit],
  );
  const editKey = useCallback(
    (channel: ChannelId, index: number, patch: { t?: number; v?: number }) =>
      commit(moveKey(animRef.current, channel, index, patch)),
    [commit],
  );
  const removeKey = useCallback(
    (channel: ChannelId, index: number) => commit(deleteKey(animRef.current, channel, index)),
    [commit],
  );
  const changeKeyMode = useCallback(
    (channel: ChannelId, index: number, mode: TangentMode) =>
      commit(setKeyMode(animRef.current, channel, index, mode)),
    [commit],
  );
  const changeKeyTangent = useCallback(
    (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) =>
      commit(setKeyTangent(animRef.current, channel, index, patch)),
    [commit],
  );
  const removeColumn = useCallback((t: number) => commit(deleteColumn(animRef.current, t)), [commit]);
  const shiftColumn = useCallback(
    (t: number, delta: number) => commit(moveColumn(animRef.current, t, delta)),
    [commit],
  );

  return {
    anim,
    setAnim,
    loop: anim.loop,
    setLoop,
    hasAnimation: animHasAnimation(anim),
    keyTimes: animKeyTimes(anim),
    duration: animDuration(anim),
    playing,
    autoPaused,
    play,
    pause,
    scrub,
    timeMs,
    selection,
    setSelection,
    insertKeyAtView,
    addKey,
    editKey,
    removeKey,
    changeKeyMode,
    changeKeyTangent,
    removeColumn,
    shiftColumn,
    beginStroke,
    strokeMoveKey,
    strokeSetTangent,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

const hasAnimationRef = (a: CameraAnimV2) => animHasAnimation(a);

export type CameraAnimState = ReturnType<typeof useCameraAnim>;
