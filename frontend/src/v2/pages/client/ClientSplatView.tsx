// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type ReactNode } from 'react';
import SplatPane from '../review/splat/SplatPane';
import { useSplat } from '../review/splat/useSplat';
import { frameCameraToMesh } from '../review/splat/scene/frameCamera';
import { useClientSplatReplay } from './useClientSplatReplay';
import { useHomeViewShortcut } from './useHomeViewShortcut';
import { clientFrameAspect, resolveClientSplat } from './clientViewerModel';
import ClientUnavailable from './ClientUnavailable';
import type { ClientMediaSource } from './clientTypes';

/**
 * Gaussian Splat viewer of the client share: the `useSplat` hook of the internal review,
 * mounted in the internal pane, without any of the editing pieces (`editor/`, painter,
 * gizmos). Saved non-destructive edits are replayed, so the client sees the cleaned scan.
 */
export default function ClientSplatView({
  source,
  originalName,
  loading,
  watermark,
  overlay,
}: {
  source: ClientMediaSource | undefined;
  originalName: string;
  loading: boolean;
  watermark: ReactNode;
  /** Annotation overlay: the pane anchors it to the delivery frame, not to the WebGL canvas. */
  overlay?: ReactNode;
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

  // File missing from the share or refused by Spark: a message addressed to the client,
  // not the internal instruction "check the format or re-upload the media".
  const failed = splat.loadError || (!loading && !file);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SplatPane
        containerRef={splat.containerRef}
        ready={splat.ready || failed}
        loadError={false}
        progress={splat.progress}
        status={loading ? 'PROCESSING' : 'READY'}
        overlay={overlay ?? null}
        aspect={clientFrameAspect(source)}
      />
      {failed && <ClientUnavailable />}
      {watermark}
    </div>
  );
}
