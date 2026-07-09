import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraEasing, SplatCameraKeyframe } from '../../reviewTypes';
import { FLY_MOVE_MAPPING } from '../scene/flyControls';
import type { SplatViewer } from '../useSplat';
import { animDuration, sampleAnim } from './cameraAnim';

/** Écart par défaut entre deux poses ajoutées (ms). */
const STEP_MS = 3000;

/**
 * Éditeur/lecteur d'animation caméra keyframe (10.G-V5) : liste de poses (ajoutées depuis la
 * vue courante), easing par segment, lecture avec boucle, scrub. **Reprise en main auto** :
 * tout input utilisateur (orbite, molette, vol clavier) met la lecture en pause — le bouton
 * « Réactiver » la relance. La lecture s'appuie sur `subscribeFrame` du viewer.
 */
export function useCameraKeyframes(splat: SplatViewer, onEdited?: () => void) {
  const { subscribeFrame, restoreCamera, captureCamera, getSceneHandle } = splat;
  const [keyframes, setKeyframes] = useState<SplatCameraKeyframe[]>([]);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  // Position de lecture : ref à la frame, état throttlé (~10 Hz) pour le scrub UI.
  const timeRef = useRef(0);
  const [timeMs, setTimeMs] = useState(0);
  const lastUi = useRef(0);
  // Copies « dernière valeur » lues par la boucle de lecture (mises à jour en effet).
  const kfRef = useRef(keyframes);
  const loopRef = useRef(loop);
  useEffect(() => {
    kfRef.current = keyframes;
    loopRef.current = loop;
  }, [keyframes, loop]);

  // Boucle de lecture : avance le temps, échantillonne la pose, l'applique à la caméra.
  useEffect(() => {
    if (!playing) return;
    return subscribeFrame((dt) => {
      timeRef.current += dt * 1000;
      const kf = kfRef.current;
      const pose = sampleAnim(kf, timeRef.current, loopRef.current);
      if (!pose) return;
      restoreCamera(pose);
      if (!loopRef.current && timeRef.current >= animDuration(kf)) setPlaying(false);
      const now = performance.now();
      if (now - lastUi.current > 100) {
        lastUi.current = now;
        setTimeMs(loopRef.current ? timeRef.current % Math.max(animDuration(kf), 1) : timeRef.current);
      }
    });
  }, [playing, subscribeFrame, restoreCamera]);

  // Reprise en main automatique : orbite/molette/vol pendant la lecture → pause.
  useEffect(() => {
    if (!playing) return;
    const dom = getSceneHandle()?.dom;
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
  }, [playing, getSceneHandle]);

  const play = useCallback(() => {
    setAutoPaused(false);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    setPlaying(false);
    setAutoPaused(false);
  }, []);

  /** Positionne la lecture (et la caméra) à `t` ms — utilisé par le scrub. */
  const scrub = useCallback(
    (t: number) => {
      timeRef.current = t;
      setTimeMs(t);
      const pose = sampleAnim(kfRef.current, t, false);
      if (pose) restoreCamera(pose);
    },
    [restoreCamera],
  );

  /** Ajoute une pose depuis la vue courante (t = fin + 3 s). */
  const addFromView = useCallback(() => {
    const view = captureCamera();
    if (!view) return;
    const pose = { position: view.position, target: view.target, fov: view.fov };
    setKeyframes((kf) => [
      ...kf,
      { t: kf.length > 0 ? animDuration(kf) + STEP_MS : 0, pose, easing: 'ease-in-out' },
    ]);
    onEdited?.();
  }, [captureCamera, onEdited]);

  const remove = useCallback(
    (index: number) => {
      setKeyframes((kf) => kf.filter((_, i) => i !== index));
      onEdited?.();
    },
    [onEdited],
  );

  const setEasing = useCallback(
    (index: number, easing: CameraEasing) => {
      setKeyframes((kf) => kf.map((k, i) => (i === index ? { ...k, easing } : k)));
      onEdited?.();
    },
    [onEdited],
  );

  /** Remplace toute l'animation (chargement de la présentation persistée, preset orbite). */
  const setAll = useCallback((kf: SplatCameraKeyframe[], loopValue: boolean) => {
    timeRef.current = 0;
    setTimeMs(0);
    setKeyframes(kf);
    setLoop(loopValue);
  }, []);

  return {
    keyframes,
    loop,
    setLoop,
    playing,
    autoPaused,
    play,
    pause,
    scrub,
    timeMs,
    duration: animDuration(keyframes),
    addFromView,
    remove,
    setEasing,
    setAll,
  };
}

export type CameraKeyframesState = ReturnType<typeof useCameraKeyframes>;
