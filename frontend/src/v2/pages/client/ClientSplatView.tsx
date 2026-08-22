// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type ReactNode } from 'react';
import SplatPane from '../review/splat/SplatPane';
import { useSplat } from '../review/splat/useSplat';
import { frameCameraToMesh } from '../review/splat/scene/frameCamera';
import { useClientSplatReplay } from './useClientSplatReplay';
import { useHomeViewShortcut } from './useHomeViewShortcut';
import { clientFrameAspect, resolveClientSplat } from './clientViewerModel';
import ClientSpatialHint from './ClientSpatialHint';
import ClientUnavailable from './ClientUnavailable';
import type { ClientMediaSource } from './clientTypes';

/**
 * Viewer Gaussian Splat du partage client : le hook `useSplat` de la review interne, monté
 * dans le pane interne, sans une seule des briques d'édition (`editor/`, painter, gizmos).
 * Les éditions non destructives enregistrées sont rejouées — le client voit le scan nettoyé.
 */
export default function ClientSplatView({
  source,
  originalName,
  loading,
  watermark,
}: {
  source: ClientMediaSource | undefined;
  originalName: string;
  loading: boolean;
  watermark: ReactNode;
}) {
  const file = resolveClientSplat(source, originalName);
  const splat = useSplat(file?.url ?? null, file?.fileName ?? '', clientFrameAspect(source));
  useClientSplatReplay(splat, source);

  const { getSceneHandle } = splat;
  const homeView = useCallback(() => {
    const handle = getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [getSceneHandle]);
  useHomeViewShortcut(homeView, splat.ready);

  // Fichier absent du partage ou refusé par Spark : message adressé au client, pas la
  // consigne interne « vérifier le format ou re-téléverser le média ».
  const failed = splat.loadError || (!loading && !file);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SplatPane
        containerRef={splat.containerRef}
        ready={splat.ready || failed}
        loadError={false}
        progress={splat.progress}
        status={loading ? 'PROCESSING' : 'READY'}
        overlay={null}
        aspect={clientFrameAspect(source)}
      />
      {failed && <ClientUnavailable />}
      {watermark}
      <ClientSpatialHint />
    </div>
  );
}
