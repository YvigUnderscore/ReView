// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import Model3DThreePane from '../review/Model3DThreePane';
import { useClientModel3D } from './useClientModel3D';
import { useClientSceneOverride } from './useClientSceneOverride';
import { useHomeViewShortcut } from './useHomeViewShortcut';
import { clientFrameAspect, resolveClientGlb } from './clientViewerModel';
import ClientSpatialHint from './ClientSpatialHint';
import ClientUnavailable from './ClientUnavailable';
import type { ClientMediaSource } from './clientTypes';

/**
 * Viewer 3D du partage client — le même pane que la review interne (`Model3DThreePane`),
 * alimenté par un hook en lecture seule. L'invité navigue (orbite, pan, vol) et rien d'autre :
 * aucun gizmo, aucune transformation de version, aucune recomposition USD n'est montée.
 */
export default function ClientModel3DView({
  source,
  loading,
  watermark,
}: {
  source: ClientMediaSource | undefined;
  /** L'URL présignée n'est pas encore arrivée — le pane affiche son état de chargement. */
  loading: boolean;
  watermark: ReactNode;
}) {
  const glb = resolveClientGlb(source);
  const viewer = useClientModel3D(glb, source);
  useClientSceneOverride(viewer.ready, viewer.getSceneHandle, source);
  useHomeViewShortcut(viewer.homeView, viewer.ready);

  // Rien à charger (GLB absent du partage) ou chargement en échec : l'invité reçoit un
  // message qui lui parle, pas la consigne interne « relancer la conversion ».
  const failed = viewer.loadError || (!loading && !glb);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Model3DThreePane
        status={loading ? 'PROCESSING' : 'READY'}
        loadError={false}
        containerRef={viewer.containerRef}
        overlay={null}
        aspect={clientFrameAspect(source)}
        canReprocess={false}
        reprocessing={false}
        onReprocess={() => undefined}
      />
      {failed && <ClientUnavailable />}
      {watermark}
      <ClientSpatialHint />
    </div>
  );
}
