// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import type { SplatCamera } from '../reviewTypes';
import { isFlyMoveCode } from '../viewer/flyControls';
import {
  animDuration,
  animKeyTimes,
  animPlayDuration,
  CHANNEL_IDS,
  deleteColumn,
  emptyAnim,
  hasAnimation as animHasAnimation,
  moveColumn,
  moveKeysBatch,
  poseToChannelValues,
  setAnimDuration,
  setChannelExtrapolation,
  upsertKey,
  upsertPoseAt,
  type CameraAnimV2,
  type ChannelId,
  type Extrapolation,
  type TangentType,
} from './channels/model';
import {
  channelRefs,
  setTangentSlope,
  setTangentType,
  type TangentSide,
  type TangentTarget,
} from './channels/tangents';
import { evalChannel } from './channels/hermite';
import { sampleAnimV2 } from './channels/hermite';
import { useCameraAutoKey } from './useCameraAutoKey';
import { useCurveSelection } from './useCurveSelection';

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
  const [autoKey, setAutoKey] = useState(false);
  const [past, setPast] = useState<CameraAnimV2[]>([]);
  const [future, setFuture] = useState<CameraAnimV2[]>([]);

  const timeRef = useRef(0);
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

  // Multi-sélection de clés (graph editor) et presse-papier — la dernière clé sélectionnée est
  // « primaire » (poignées de tangente, caméra-objet). Phase 27, 40.E.
  const {
    selection,
    setSelection,
    clearSelection,
    applyTangentType,
    setSelectionBroken,
    setSelectionWeighted,
    removeSelection,
    copySelection,
    paste,
    canPaste,
  } = useCurveSelection({ animRef, timeRef, commit });

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
  /**
   * Pente (et poids) d'un côté de tangente, en direct pendant le drag d'une poignée. Le côté
   * opposé est matérialisé par `setTangentSlope` : sans cela, tirer UNE poignée faisait lire
   * l'autre comme nulle et aplatissait la courbe.
   */
  const strokeSetTangent = useCallback(
    (channel: ChannelId, index: number, side: TangentSide, slope: number, weight?: number) =>
      setAnimState(setTangentSlope(animRef.current, channel, index, side, slope, weight)),
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
      clearSelection();
      const view = captureCamera();
      if (view) baseRef.current = view;
      setAnimState(next);
    },
    [captureCamera, clearSelection],
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
      // Playhead fluide : l'UI suit chaque frame (React 18 groupe les rendus) — le throttle à
      // 100 ms faisait avancer la tête de lecture par saccades.
      setTimeMs(a.loop ? timeRef.current % Math.max(duration, 1) : timeRef.current);
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
      // Même référence des touches de vol que `flyControls`, et même garde de saisie : sans elle,
      // taper « was » dans un commentaire mettait la lecture en pause.
      if (isFlyMoveCode(e.code) && !isEditable(e.target)) pause();
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

  /**
   * Pose une clé sur **un seul canal** au playhead, depuis la vue courante (ligne du dopesheet).
   * Si la vue ne porte pas la valeur (fov/roll absents de la capture), retombe sur la valeur
   * échantillonnée du canal — poser une clé n'altère alors pas la courbe.
   */
  const insertChannelKeyAtView = useCallback(
    (channel: ChannelId, t?: number) => {
      const time = Math.max(0, Math.round(t ?? timeRef.current));
      const view = captureCamera();
      const fromView = view ? poseToChannelValues(view)[channel] : undefined;
      const v = fromView ?? evalChannel(animRef.current.channels[channel], time, 0);
      commit(upsertKey(animRef.current, channel, time, v));
    },
    [captureCamera, commit],
  );

  /** Retime en direct une colonne du dopesheet (drag d'un losange de la règle). Live — appeler
   *  `beginStroke` au début du geste pour un undo unique. */
  const strokeMoveColumn = useCallback((fromT: number, toT: number) => {
    const delta = Math.round(toT) - Math.round(fromT);
    if (delta !== 0) setAnimState(moveColumn(animRef.current, Math.round(fromT), delta));
  }, []);

  /** Supprime toutes les clés d'une colonne du dopesheet (Alt+clic sur un losange). */
  const removeColumn = useCallback(
    (t: number) => commit(deleteColumn(animRef.current, Math.round(t))),
    [commit],
  );

  /** Applique un profil de tangente à **toute** une courbe (clic droit sur la ligne du canal). */
  const applyChannelTangent = useCallback(
    (channel: ChannelId, type: TangentType, target?: TangentTarget) =>
      commit(setTangentType(animRef.current, channelRefs(animRef.current, channel), type, target)),
    [commit],
  );

  /** Extrapolation d'un canal hors de ses clés (pré/post-infinity) — persistée avec l'animation. */
  const setExtrapolation = useCallback(
    (channel: ChannelId, patch: { pre?: Extrapolation; post?: Extrapolation }) =>
      commit(setChannelExtrapolation(animRef.current, channel, patch)),
    [commit],
  );

  /** Sélectionne toutes les clés d'une courbe (puis les outils de tangente s'y appliquent). */
  const selectChannel = useCallback(
    (channel: ChannelId) => setSelection(channelRefs(animRef.current, channel)),
    [setSelection],
  );

  // Auto-key (Phase 27) : tout geste caméra pose une clé de la vue au temps de lecture.
  useCameraAutoKey(autoKey, getDom, insertKeyAtView);

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
    insertChannelKeyAtView,
    strokeMoveColumn,
    removeColumn,
    applyTangentType,
    setSelectionBroken,
    setSelectionWeighted,
    applyChannelTangent,
    setExtrapolation,
    selectChannel,
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
