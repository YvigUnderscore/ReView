import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import {
  DEFAULT_LIGHTING,
  type LightingConfig,
  type MediaResp,
  type SplatEditsPatch,
  type SplatPresentation,
} from '../reviewTypes';
import { useCameraPresentation } from '../camera/useCameraPresentation';
import { applyLighting, loadHdriEnvironment, type HdriEnvironment } from './hdriEnvironment';
import { setGroundShadow } from './groundShadow';
import type { Model3DThreeState } from './useModel3DThree';

/** Entrée de la bibliothèque HDRI (miroir de `HdriService.listWithUrls`). */
export interface HdriItem {
  id: string;
  name: string;
  format: 'hdr' | 'exr';
  url: string;
}

/**
 * Éclairage HDRI du viewer 3D (Phase 29) : charge un environnement de la **bibliothèque instance**
 * (`/api/studio/hdris`), l'applique à la scène (exposition + rotation + fond optionnel), rejoue la
 * config **persistée par défaut** (gestionnaire) à l'ouverture pour tous, et laisse les spectateurs
 * **tweaker en session** (non persisté — reprise du défaut au rechargement). Le gestionnaire
 * enregistre/efface le défaut dans `splatPresentation.lighting` (fusion côté client pour préserver
 * la caméra/animation déjà persistées).
 */
export function useModel3DLighting(
  model3d: Model3DThreeState,
  data: MediaResp,
  canManage: boolean,
  onSaved: (patch: SplatEditsPatch) => void,
) {
  const { ready, getSceneHandle } = model3d;
  const { busy, persist } = useCameraPresentation(data.media.id, onSaved);
  // Éclairage initial : réglage propre du média, sinon défaut projet (39.F), sinon neutre.
  // Fusion sur DEFAULT_LIGHTING pour tolérer les champs absents des enregistrements anciens.
  const [cfg, setCfg] = useState<LightingConfig>(
    data.splatPresentation?.lighting
      ? { ...DEFAULT_LIGHTING, ...data.splatPresentation.lighting }
      : data.projectDefaultLighting
        ? { ...DEFAULT_LIGHTING, ...data.projectDefaultLighting }
        : DEFAULT_LIGHTING,
  );
  const envRef = useRef<HdriEnvironment | null>(null);
  const loadedIdRef = useRef<string | undefined>(undefined);

  const { data: hdris } = useQuery({
    queryKey: qk.hdris,
    queryFn: () => api.get<{ hdris: HdriItem[] }>('/api/studio/hdris').then((d) => d.hdris),
  });

  // Applique la config d'éclairage à la scène ; (dé)charge l'HDRI quand `hdriId` change.
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.renderer) return;
    const { THREE, scene, renderer } = handle;
    const item = cfg.hdriId ? hdris?.find((h) => h.id === cfg.hdriId) : undefined;
    const apply = () => applyLighting(scene, renderer, envRef.current?.texture ?? null, cfg);

    if (!item) {
      envRef.current?.dispose();
      envRef.current = null;
      loadedIdRef.current = undefined;
      apply();
      return;
    }
    if (loadedIdRef.current === item.id && envRef.current) {
      apply();
      return;
    }
    let cancelled = false;
    void loadHdriEnvironment(THREE, renderer, item.url, item.format)
      .then((env) => {
        if (cancelled) {
          env.dispose();
          return;
        }
        envRef.current?.dispose();
        envRef.current = env;
        loadedIdRef.current = item.id;
        apply();
      })
      .catch(() => {
        /* échec de chargement : conserve l'éclairage courant */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, getSceneHandle, hdris, cfg]);

  // Sol récepteur d'ombres (39.F) : plan invisible ShadowMaterial sous le modèle, piloté par
  // `cfg.groundShadow`. Effet dédié — indépendant de l'HDRI (l'ombre ne dépend pas de son intensité).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.renderer) return;
    setGroundShadow(handle, cfg.groundShadow);
  }, [ready, getSceneHandle, cfg.groundShadow]);

  // Libération de l'environnement et du sol d'ombres au démontage.
  useEffect(
    () => () => {
      envRef.current?.dispose();
      envRef.current = null;
    },
    [],
  );

  const save = useCallback(async () => {
    const base: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    await persist({ ...base, lighting: cfg });
  }, [data.splatPresentation, persist, cfg]);

  const clear = useCallback(async () => {
    setCfg(DEFAULT_LIGHTING);
    const base: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    delete base.lighting;
    await persist(base);
  }, [data.splatPresentation, persist]);

  return {
    cfg,
    setCfg,
    hdris: hdris ?? [],
    busy,
    save: canManage ? save : undefined,
    clear: canManage ? clear : undefined,
  };
}

export type Model3DLightingState = ReturnType<typeof useModel3DLighting>;
