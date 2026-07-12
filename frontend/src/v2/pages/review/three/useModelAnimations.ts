import { useCallback, useState, type RefObject } from 'react';
import type * as THREE from 'three';

interface AnimRuntime {
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
}

/**
 * Contrôle des animations du GLB (Phase 15, extrait de `useModel3DThree` pour le budget) :
 * liste des clips, lecture/pause (via `AnimationAction`), sélection. Le mixer est avancé par la
 * boucle de rendu du hook parent ; ici on ne fait que piloter l'action courante.
 */
export function useModelAnimations(
  runtimeRef: RefObject<AnimRuntime | null>,
  actionRef: RefObject<THREE.AnimationAction | null>,
) {
  const [animations, setAnimations] = useState<string[]>([]);
  const [currentAnim, setCurrentAnim] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  /** Initialise la liste au chargement du modèle. */
  const init = useCallback((clips: THREE.AnimationClip[]) => {
    setAnimations(clips.map((c) => c.name));
    setCurrentAnim(clips[0]?.name ?? null);
    setPlaying(false);
  }, []);

  const playAnim = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt?.mixer) return;
    if (actionRef.current?.paused) {
      actionRef.current.paused = false;
      setPlaying(true);
      return;
    }
    const clip = rt.clips.find((c) => c.name === currentAnim) ?? rt.clips[0];
    if (!clip) return;
    actionRef.current?.stop();
    const action = rt.mixer.clipAction(clip);
    action.reset().play();
    actionRef.current = action;
    setPlaying(true);
  }, [runtimeRef, actionRef, currentAnim]);

  const pauseAnim = useCallback(() => {
    if (actionRef.current) actionRef.current.paused = true;
    setPlaying(false);
  }, [actionRef]);

  const selectAnim = useCallback(
    (name: string) => {
      setCurrentAnim(name);
      const rt = runtimeRef.current;
      if (!rt?.mixer) return;
      const clip = rt.clips.find((c) => c.name === name);
      if (!clip) return;
      actionRef.current?.stop();
      const action = rt.mixer.clipAction(clip);
      actionRef.current = action;
      if (playing) action.reset().play();
    },
    [runtimeRef, actionRef, playing],
  );

  return { animations, currentAnim, playing, init, playAnim, pauseAnim, selectAnim };
}
