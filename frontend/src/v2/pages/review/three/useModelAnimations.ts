// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type * as THREE from 'three';

interface AnimRuntime {
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Contrôle des animations du GLB (Phase 15, transport complet en 40.A). Liste des clips, sélection
 * avec **crossfade**, transport pro : lecture/pause, **scrub** (temps ms), **vitesse** (timeScale),
 * **boucle** on/off, durée du clip courant. Le mixer est avancé par la boucle de rendu du parent ;
 * ici on pilote l'`AnimationAction` et on lit son temps via un abonnement à la boucle (throttlé).
 */
export function useModelAnimations(
  runtimeRef: RefObject<AnimRuntime | null>,
  actionRef: RefObject<THREE.AnimationAction | null>,
  threeRef: RefObject<typeof import('three') | null>,
  subscribeFrame: (cb: (dt: number) => void) => () => void,
) {
  const [animations, setAnimations] = useState<string[]>([]);
  const [currentAnim, setCurrentAnim] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoopState] = useState(true);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const loopRef = useRef(true);
  const lastTickRef = useRef(0);

  const setPlay = (v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  };

  const clipByName = useCallback(
    (name: string | null): THREE.AnimationClip | undefined =>
      runtimeRef.current?.clips.find((c) => c.name === name),
    [runtimeRef],
  );

  /** Configure une action selon boucle/vitesse courantes (sans démarrer la lecture). */
  const configure = useCallback(
    (action: THREE.AnimationAction) => {
      const THREE = threeRef.current;
      if (!THREE) return action;
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setLoop(loopRef.current ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.setEffectiveTimeScale(speedRef.current);
      action.setEffectiveWeight(1);
      return action;
    },
    [threeRef],
  );

  /** Initialise la liste au chargement du modèle et pose le modèle sur la 1re frame du 1er clip. */
  const init = useCallback(
    (clips: THREE.AnimationClip[]) => {
      setAnimations(clips.map((c) => c.name));
      const first = clips[0] ?? null;
      setCurrentAnim(first?.name ?? null);
      setPlay(false);
      setTimeMs(0);
      setDurationMs(first ? first.duration * 1000 : 0);
      const rt = runtimeRef.current;
      if (first && rt?.mixer) {
        const action = configure(rt.mixer.clipAction(first));
        action.reset().play();
        action.paused = true; // frame 0 affichée, lecture à l'arrêt
        rt.mixer.update(0);
        actionRef.current = action;
      }
    },
    [runtimeRef, actionRef, configure],
  );

  const play = useCallback(() => {
    // L'action courante est amorcée par `init`/`selectAnim` (un mixer existe dès qu'il y a un clip).
    if (!actionRef.current) return;
    actionRef.current.paused = false;
    if (!actionRef.current.isRunning()) actionRef.current?.reset().play();
    setPlay(true);
  }, [actionRef]);

  const pause = useCallback(() => {
    if (actionRef.current) actionRef.current.paused = true;
    setPlay(false);
  }, [actionRef]);

  const selectAnim = useCallback(
    (name: string) => {
      setCurrentAnim(name);
      const rt = runtimeRef.current;
      const clip = clipByName(name);
      if (!rt?.mixer || !clip) return;
      const prev = actionRef.current;
      const next = configure(rt.mixer.clipAction(clip));
      next.reset();
      setDurationMs(clip.duration * 1000);
      setTimeMs(0);
      if (prev && prev !== next && playingRef.current) {
        next.play();
        prev.crossFadeTo(next, 0.3, false); // fondu enchaîné pendant la lecture
      } else {
        prev?.stop();
        next.play();
        if (!playingRef.current) {
          next.paused = true;
          rt.mixer.update(0);
        }
      }
      actionRef.current = next;
    },
    [runtimeRef, actionRef, configure, clipByName],
  );

  /** Positionne la tête de lecture (ms) et met en pause — applique la pose immédiatement. */
  const scrub = useCallback(
    (ms: number) => {
      const rt = runtimeRef.current;
      const action = actionRef.current;
      if (!rt?.mixer || !action) return;
      action.paused = true;
      setPlay(false);
      action.time = clamp(ms / 1000, 0, action.getClip().duration);
      rt.mixer.update(0);
      setTimeMs(action.time * 1000);
    },
    [runtimeRef, actionRef],
  );

  const setSpeed = useCallback(
    (value: number) => {
      speedRef.current = value;
      setSpeedState(value);
      actionRef.current?.setEffectiveTimeScale(value);
    },
    [actionRef],
  );

  const setLoop = useCallback(
    (value: boolean) => {
      loopRef.current = value;
      setLoopState(value);
      const THREE = threeRef.current;
      if (THREE) actionRef.current?.setLoop(value ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    },
    [actionRef, threeRef],
  );

  // Lecture du temps courant depuis la boucle de rendu (après `mixer.update`), throttlé ~20 Hz
  // pour ne pas re-rendre le HUD à 60 fps. Détecte aussi la fin d'un clip non bouclé.
  useEffect(
    () =>
      subscribeFrame(() => {
        if (!playingRef.current) return;
        const action = actionRef.current;
        if (!action) return;
        if (!action.isRunning()) {
          setPlay(false);
          setTimeMs(action.time * 1000);
          return;
        }
        const now = performance.now();
        if (now - lastTickRef.current < 50) return;
        lastTickRef.current = now;
        setTimeMs(action.time * 1000);
      }),
    [subscribeFrame, actionRef],
  );

  return {
    animations,
    currentAnim,
    playing,
    timeMs,
    durationMs,
    speed,
    loop,
    init,
    play,
    pause,
    selectAnim,
    scrub,
    setSpeed,
    setLoop,
  };
}
