// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import CompareSelect from '../CompareSelect';
import type { MediaSummary } from '@/v2/types/api';

/** Selection of other versions exposed by the spatial comparison hooks. */
export interface CompareVersionsApi {
  ids: number[];
  add: (mediaId: number, media?: MediaSummary) => void;
  remove: (mediaId: number) => void;
  set: (mediaId: number | null, media?: MediaSummary) => void;
}

/**
 * Right corner of the header of the spatial viewers: the viewer's comparison tabs (models or splats
 * already in the scene), followed by the picker of other **versions**.
 *
 * The picker was only mounted for video and image: comparing v003 and v004 of the same asset, the most
 * common review case, was impossible in 3D and for splats, whereas the common scene already knew how to
 * accommodate them. It hides itself on its own when the task or asset carries only one version.
 */
export default function SpatialCompareHeader({
  versionId,
  mediaId,
  kind,
  versions,
  children,
}: {
  versionId: number;
  mediaId: number;
  kind: 'MODEL_3D' | 'SPLAT';
  versions: CompareVersionsApi;
  /** Viewer tab bar (comparison already loaded), to the left of the picker. */
  children?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2">
      {children}
      <CompareSelect
        versionId={versionId}
        mediaId={mediaId}
        kind={kind}
        compareIds={versions.ids}
        onAdd={versions.add}
        onRemove={versions.remove}
        onSet={versions.set}
      />
    </span>
  );
}
