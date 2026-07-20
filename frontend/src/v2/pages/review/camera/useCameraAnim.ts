import { useCallback, useEffect, useRef, useState } from 'react';
import type { SplatCamera } from '../reviewTypes';
import { FLY_MOVE_MAPPING } from '../viewer/flyControls';
import {
  animDuration,
  animKeyTimes,
  animPlayDuration,
  CHANNEL_IDS,
  deleteKeys,
  emptyAnim,
  hasAnimation as animHasAnimation,
  moveKeysBatch,
  setAnimDuration,
  setKeyTangent,
  upsertKey,
  upsertPoseAt,
  type CameraAnimV2,
  type ChannelId,
  type KeyRef,
} from './channels/model';
import { sampleAnimV2 } from './channels/hermite';
import {
  copyKeys,
  loadClipboard,
  pasteKeys,
  persistClipboard,
  type CurveClipboard,
} from './channels/clipboard';

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
 * Lecteur + éditeur d'animation caméra par F-curves (Phase 17, v2 ; Phase 27) : transport
 * (play/pause/scrub, boucle **0→durée réglable**), échantillonnage Hermite par frame, **reprise en
 * main auto** (tout input met en pause), édition des clés (poser depuis la vue, **multi-sélection**
 * + déplacement groupé, tangentes, suppression de lot) et undo/redo local. **Auto-key** optionnel :
 * tout geste caméra pose une clé au temps de lecture. La lecture s'appuie sur `subscribeFrame`.
 */
export function useCameraAnim(controller: CameraController) {
  const { subscribeFrame, restoreCamera, captureCamera, getDom } = controller;
  const [anim, setAnimState] = useState<CameraAnimV2>(() => emptyAnim());
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  // Multi-sélection de clés (graph editor) — la dernière est « primaire » (poignées de tangente,
  // caméra-objet). Phase 27.
  const [selection, setSelectionState] = useState<KeyRef[]>([]);
  const [autoKey, setAutoKey] = useState(false);
  const [past, setPast] = useState<CameraAnimV2[]>([]);
  const [future, setFuture] = useState<CameraAnimV2[]>([]);

  const timeRef = useRef(0);
  const lastUi = useRef(0);
  const animRef = useRef(anim);
  const selectionRef = useRef(selection);
  const baseRef = useRef<SplatCamera>({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
  useEffect(() => {
    animRef.current = anim;
  }, [anim]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const setSelection = useCallback((sels: KeyRef[]) => setSelectionState(sels), []);

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
  // Geste continu (drag d'une/plusieurs clés/tangente) : un seul snapshot au début, puis mises à
  // jour live sans empiler — un undo annule tout le geste.
  const beginStroke = useCallback(() => pushHistory(), [pushHistory]);
  /**
   * Déplacement groupé (multi-sélection) recalculé depuis le baseline capturé au début du drag :
   * les index restent cohérents pendant tout le geste (Phase 27).
   */
  const strokeMoveKeys = useCallback(
    (baseline: CameraAnimV2, moves: Array<{ channel: ChannelId; index: number; t: number; v: number }>) =>
      setAnimState(moveKeysBatch(baseline, moves)),
    [],
  );
  const strokeSetTangent = useCallback(
    (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) =>
      setAnimState(setKeyTangent(animRef.current, channel, index, patch)),
    [],
  );
  /** Écrit/écrase plusieurs canaux au temps `t` (drag de la caméra-objet — auto-key). Live. */
  const strokeUpsertAt = useCallback((t: number, values: Partial<Record<ChannelId, number>>) => {
    let next = animRef.current;
    const time = Math.max(0, Math.round(t));
    for (const id of CHANNEL_IDS) {
      const v = values[id];
      if (v != null) next = upsertKey(next, id, time, v);
    }
    setAnimState(next);
  }, []);

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
      setSelectionState([]);
      const view = captureCamera();
      if (view) baseRef.current = view;
      setAnimState(next);
    },
    [captureCamera],
  );

  const setLoop = useCallback((loop: boolean) => commit({ ...animRef.current, loop }), [commit]);
  /** Durée de lecture réglable (0/undefined = automatique = dernier temps de clé). */
  const setDuration = useCallback(
    (ms: number | undefined) => commit(setAnimDuration(animRef.current, ms)),
    [commit],
  );

  // Boucle de lecture : avance le temps, échantillonne la pose, l'applique à la caméra.
  useEffect(() => {
    if (!playing) return;
    return subscribeFrame((dt) => {
      timeRef.current += dt * 1000;
      const a = animRef.current;
      restoreCamera(sampleAnimV2(a, timeRef.current, baseRef.current));
      const duration = animPlayDuration(a);
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
      if (!animHasAnimation(animRef.current)) baseRef.current = view;
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

  /** Supprime les clés sélectionnées (Suppr). */
  const removeSelection = useCallback(() => {
    const sels = selectionRef.current;
    if (!sels.length) return;
    commit(deleteKeys(animRef.current, sels));
    setSelectionState([]);
  }, [commit]);

  // ── Copier/coller de clés (40.E) : presse-papier mémoire + `localStorage` (cross-média). ──
  const clipboardRef = useRef<CurveClipboard | null>(loadClipboard());
  const [canPaste, setCanPaste] = useState(() => loadClipboard() != null);

  /** Copie les clés sélectionnées (valeur, mode, tangentes) dans le presse-papier (Ctrl+C). */
  const copySelection = useCallback(() => {
    const clip = copyKeys(animRef.current, selectionRef.current);
    if (!clip) return;
    clipboardRef.current = clip;
    persistClipboard(clip);
    setCanPaste(true);
  }, []);

  /** Colle le presse-papier à la tête de lecture et sélectionne les clés collées (Ctrl+V). */
  const paste = useCallback(() => {
    const clip = clipboardRef.current ?? loadClipboard();
    if (!clip) return;
    const { anim: next, selection: pasted } = pasteKeys(animRef.current, clip, timeRef.current);
    commit(next);
    setSelectionState(pasted);
  }, [commit]);

  // Auto-key (Phase 27) : activé, tout geste caméra (drag orbite/pan, molette) pose une clé de la
  // vue courante au temps de lecture — façon DCC.
  useEffect(() => {
    if (!autoKey) return;
    const dom = getDom();
    if (!dom) return;
    let sx = 0;
    let sy = 0;
    let moved = false;
    let wheelTimer: number | undefined;
    const onDown = (e: PointerEvent) => {
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 3) moved = true;
    };
    const onUp = () => {
      if (moved) insertKeyAtView();
    };
    const onWheel = () => {
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => insertKeyAtView(), 250);
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.clearTimeout(wheelTimer);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('wheel', onWheel);
    };
  }, [autoKey, getDom, insertKeyAtView]);

  return {
    anim,
    setAnim,
    loop: anim.loop,
    setLoop,
    hasAnimation: animHasAnimation(anim),
    keyTimes: animKeyTimes(anim),
    duration: animDuration(anim),
    playDuration: animPlayDuration(anim),
    setDuration,
    playing,
    autoPaused,
    play,
    pause,
    scrub,
    timeMs,
    selection,
    setSelection,
    autoKey,
    setAutoKey,
    insertKeyAtView,
    addKey,
    removeSelection,
    copySelection,
    paste,
    canPaste,
    beginStroke,
    strokeMoveKeys,
    strokeSetTangent,
    strokeUpsertAt,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export type CameraAnimState = ReturnType<typeof useCameraAnim>;
