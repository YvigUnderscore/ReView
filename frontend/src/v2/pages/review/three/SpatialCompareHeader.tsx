// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import CompareSelect from '../CompareSelect';
import type { MediaSummary } from '../../../types/api';

/** Sélection d'autres versions exposée par les hooks de comparaison spatiale. */
export interface CompareVersionsApi {
  ids: number[];
  add: (mediaId: number, media?: MediaSummary) => void;
  remove: (mediaId: number) => void;
  set: (mediaId: number | null, media?: MediaSummary) => void;
}

/**
 * Coin droit de l'en-tête des viewers spatiaux : les onglets de comparaison du viewer
 * (modèles ou splats déjà en scène) suivis du sélecteur d'autres **versions**.
 *
 * Le sélecteur n'était monté que pour la vidéo et l'image : comparer v003 et v004 d'un même
 * asset, le cas de review le plus courant, était impossible en 3D et en splat alors que la
 * scène commune savait déjà les accueillir. Il se masque tout seul quand la tâche ou l'asset
 * ne porte qu'une version.
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
  /** Barre d'onglets du viewer (comparaison déjà chargée), à gauche du sélecteur. */
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
