import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import {
  DEFAULT_TRANSFORM,
  type Hotspot3D, type MediaResp, type ModelCamera, type ModelViewerEl, type Transform,
} from './reviewTypes';

/**
 * Encapsule l'état du modèle 3D (model-viewer) : transformation chargée depuis la
 * version et appliquée en live, animations du GLB, caméra libre, erreur de
 * chargement, raycast hotspot et capture/restauration de vue caméra.
 */
export function useModel3D(data: MediaResp | null, glbSrc: string | null) {
  const active = data?.media.kind === 'MODEL_3D';
  const versionId = data?.media.versionId;
  const modelRef = useRef<HTMLElement | null>(null);
  const [savedTf, setSavedTf] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  // Animations du modèle 3D (si présentes dans le GLB)
  const [animations, setAnimations] = useState<string[]>([]);
  const [currentAnim, setCurrentAnim] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const mv = () => modelRef.current as ModelViewerEl | null;

  // Transformation : valeur enregistrée sur la version (query), surchargée par
  // l'édition locale en cours tant qu'elle n'est pas sauvegardée.
  const versionQ = useQuery({
    queryKey: qk.version(versionId ?? 0),
    queryFn: () => api.get<{ version: { transform: Partial<Transform> | null } }>(`/api/versions/${versionId}`).then((d) => d.version),
    enabled: active && !!versionId,
  });
  const [tfEdit, setTfEdit] = useState<Transform | null>(null);
  const savedTransform = versionQ.data?.transform;
  const transform = useMemo(
    () => tfEdit ?? (savedTransform ? { ...DEFAULT_TRANSFORM, ...savedTransform } : DEFAULT_TRANSFORM),
    [tfEdit, savedTransform],
  );

  useEffect(() => {
    if (!active) return;
    setLoadError(false);
    import('@google/model-viewer').catch(() => toast.error('Visionneuse 3D indisponible'));
  }, [active, versionId]);

  // Applique orientation/échelle au modèle (live) + écoute l'erreur de chargement.
  useEffect(() => {
    const m = mv();
    if (m && active) {
      m.setAttribute('orientation', `${transform.roll}deg ${transform.pitch}deg ${transform.yaw}deg`);
      m.setAttribute('scale', `${transform.scale} ${transform.scale} ${transform.scale}`);
      const onErr = () => setLoadError(true);
      m.addEventListener('error', onErr);
      return () => m.removeEventListener('error', onErr);
    }
  }, [transform, active, glbSrc]);

  // Détecte les animations du GLB une fois chargé (availableAnimations).
  useEffect(() => {
    const m = mv();
    if (!m || !active) return;
    const readAnims = () => {
      const av = (m.availableAnimations ?? []) as string[];
      setAnimations(av);
      setCurrentAnim((c) => (c && av.includes(c) ? c : av[0] ?? null));
      setPlaying(false);
    };
    if (m.loaded) readAnims();
    m.addEventListener('load', readAnims);
    return () => m.removeEventListener('load', readAnims);
  }, [active, glbSrc]);

  const playAnim = () => {
    const m = mv();
    if (!m) return;
    if (currentAnim) m.setAttribute('animation-name', currentAnim);
    m.play?.({ repetitions: Infinity });
    setPlaying(true);
  };
  const pauseAnim = () => { mv()?.pause?.(); setPlaying(false); };
  const selectAnim = (name: string) => {
    setCurrentAnim(name);
    const m = mv();
    if (m) { m.setAttribute('animation-name', name); if (playing) m.play?.({ repetitions: Infinity }); }
  };

  // Mise à jour live de la transformation : état + application immédiate sur le modèle.
  // model-viewer met en pause son rendu à l'arrêt : on le réveille en réécrivant
  // l'orbite courante (valeur identique → pas de mouvement, mais une frame est rendue).
  const updateTransform = (patch: Partial<Transform>) => {
    const next = { ...transform, ...patch };
    const m = mv();
    if (m) {
      m.setAttribute('orientation', `${next.roll}deg ${next.pitch}deg ${next.yaw}deg`);
      m.setAttribute('scale', `${next.scale} ${next.scale} ${next.scale}`);
      const o = m.getCameraOrbit?.();
      if (o) m.cameraOrbit = `${o.theta}rad ${o.phi}rad ${o.radius}m`;
    }
    setTfEdit(next);
  };

  const saveTransform = async () => {
    if (!versionId) return;
    try {
      await api.patch(`/api/versions/${versionId}`, { transform });
      setSavedTf(true); setTimeout(() => setSavedTf(false), 1500);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erreur à l\'enregistrement de la transformation'); }
  };

  /** Hotspot sur la surface au centre du viewer (raycast au point central), sinon null. */
  const hotspotAtCenter = (): Hotspot3D | null => {
    const m = mv();
    if (!m?.positionAndNormalFromPoint) return null;
    const r = m.getBoundingClientRect();
    const res = m.positionAndNormalFromPoint(r.width / 2, r.height / 2);
    return res ? { position: res.position.toString(), normal: res.normal.toString() } : null;
  };

  // Capture l'état caméra (orbite + cible + focale + ratio) pour rejouer la vue.
  const captureCamera = (): ModelCamera | undefined => {
    const m = mv();
    if (!m?.getCameraOrbit) return undefined;
    const r = m.getBoundingClientRect();
    return {
      orbit: m.getCameraOrbit(), target: m.getCameraTarget?.(), fov: m.getFieldOfView?.(),
      aspect: r.height > 0 ? r.width / r.height : undefined,
    };
  };

  // Restaure une vue caméra avec une transition fluide (interpolation-decay ≈ 1 s).
  const restoreCamera = (cs: unknown) => {
    const m = mv();
    const snap = cs as ModelCamera | null;
    if (m && snap?.orbit) {
      m.cameraOrbit = `${snap.orbit.theta}rad ${snap.orbit.phi}rad ${snap.orbit.radius}m`;
      if (snap.target) m.cameraTarget = `${snap.target.x}m ${snap.target.y}m ${snap.target.z}m`;
      if (snap.fov != null) m.fieldOfView = `${snap.fov}deg`;
    }
  };

  const clearLoadError = useCallback(() => setLoadError(false), []);

  return {
    modelRef, transform, updateTransform, saveTransform, savedTf,
    loadError, clearLoadError, freeCamera, setFreeCamera,
    animations, currentAnim, playing, playAnim, pauseAnim, selectAnim,
    hotspotAtCenter, captureCamera, restoreCamera,
  };
}

export type Model3DState = ReturnType<typeof useModel3D>;
