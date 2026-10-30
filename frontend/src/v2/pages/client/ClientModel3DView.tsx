// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import Model3DThreePane from '../review/Model3DThreePane';
import { useClientModel3D } from './useClientModel3D';
import { useClientSceneOverride } from './useClientSceneOverride';
import { useHomeViewShortcut } from './useHomeViewShortcut';
import { clientFrameAspect, resolveClientGlb } from './clientViewerModel';
import ClientUnavailable from './ClientUnavailable';
import type { ClientMediaSource } from './clientTypes';

/**
 * 3D viewer of the client share: the same pane as the internal review (`Model3DThreePane`),
 * fed by a read-only hook. The guest can navigate (orbit, pan, fly) and nothing else: no
 * gizmo, no version transform and no USD recomposition is mounted.
 */
export default function ClientModel3DView({
  source,
  loading,
  watermark,
  overlay,
}: {
  source: ClientMediaSource | undefined;
  /** The presigned URL has not arrived yet: the pane shows its loading state. */
  loading: boolean;
  watermark: ReactNode;
  /** Annotation overlay: the pane anchors it to the delivery frame, not to the WebGL canvas. */
  overlay?: ReactNode;
}) {
  const glb = resolveClientGlb(source);
  const viewer = useClientModel3D(glb, source);
  useClientSceneOverride(viewer.ready, viewer.getSceneHandle, source);
  useHomeViewShortcut(viewer.homeView, viewer.ready);

  // Nothing to load (GLB absent from the share) or loading failed: the guest gets a message
  // addressed to them, not the internal instruction "re-run the conversion".
  const failed = viewer.loadError || (!loading && !glb);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Model3DThreePane
        status={loading ? 'PROCESSING' : 'READY'}
        loadError={false}
        containerRef={viewer.containerRef}
        overlay={overlay ?? null}
        aspect={clientFrameAspect(source)}
        canReprocess={false}
        reprocessing={false}
        onReprocess={() => undefined}
      />
      {failed && <ClientUnavailable />}
      {watermark}
    </div>
  );
}
