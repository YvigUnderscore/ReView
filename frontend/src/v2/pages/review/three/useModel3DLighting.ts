// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
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

/** Entry of the HDRI library (mirror of `HdriService.listWithUrls`). */
export interface HdriItem {
  id: string;
  name: string;
  format: 'hdr' | 'exr';
  url: string;
}

/**
 * HDRI lighting of the 3D viewer (Phase 29): loads an environment from the **instance library**
 * (`/api/studio/hdris`), applies it to the scene (exposure + rotation + optional background),
 * replays the **persisted default** config (set by the manager) on opening, for everyone, and lets
 * viewers **tweak it in session** (not persisted — the default is restored on reload). The manager
 * saves/clears the default in `splatPresentation.lighting` (client-side merge to preserve the camera
 * and animation already persisted).
 */
export function useModel3DLighting(
  model3d: Model3DThreeState,
  data: MediaResp,
  canManage: boolean,
  onSaved: (patch: SplatEditsPatch) => void,
) {
  const { ready, getSceneHandle } = model3d;
  const { busy, persist } = useCameraPresentation(data.media.id, onSaved);
  // Initial lighting: the media's own setting, otherwise the project default (39.F), otherwise neutral.
  // Merged over DEFAULT_LIGHTING to tolerate fields absent from older records.
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

  // Applies the lighting config to the scene; (un)loads the HDRI when `hdriId` changes.
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
        /* loading failure: keeps the current lighting */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, getSceneHandle, hdris, cfg]);

  // Shadow-receiving ground (39.F): invisible ShadowMaterial plane under the model, driven by
  // `cfg.groundShadow`. Dedicated effect — independent of the HDRI (the shadow does not depend on its intensity).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.renderer) return;
    setGroundShadow(handle, cfg.groundShadow);
  }, [ready, getSceneHandle, cfg.groundShadow]);

  // Release of the environment and of the shadow ground on unmount.
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
