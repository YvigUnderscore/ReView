// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ClientUnavailable from './ClientUnavailable';
import type { Annotations } from '../review/useAnnotations';
import { VIEWER_ZONE } from '../review/reviewTypes';
import { useT } from '../../i18n';

/**
 * Branche **image** de la page client : la visionneuse de la review, pas un `<img>` nu.
 *
 * L'ancienne version posait l'image directement dans la zone du viewer, sans conteneur
 * mesuré : il n'y avait donc aucun endroit où poser un overlay dont les coordonnées 0..1
 * tombent juste. `ImageReviewViewer` porte déjà le fit, le zoom/pan et le canevas
 * d'annotation **dans le plan transformé** — dessin et image subissent la même
 * transformation, l'annotation reste alignée au pixel quel que soit le zoom.
 */
export default function ClientImageView({
  src,
  alt,
  ann,
  canAnnotate,
  failed,
  loading,
  watermark,
}: {
  src: string | null;
  alt: string;
  ann: Annotations;
  canAnnotate: boolean;
  failed: boolean;
  loading: boolean;
  watermark: ReactNode;
}) {
  const t = useT();

  if (!src)
    return (
      <div className={VIEWER_ZONE}>
        {failed ? (
          <ClientUnavailable />
        ) : (
          <p className="p-10 text-sm text-muted-foreground">{loading ? t('common.loading') : ''}</p>
        )}
        {watermark}
      </div>
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ImageReviewViewer
        src={src}
        alt={alt}
        // L'annotation d'un commentaire sélectionné l'emporte sur le brouillon : on regarde
        // ce que le studio montre, on ne dessine pas par-dessus.
        shapes={ann.viewed ?? ann.annot}
        onChange={ann.setShapes}
        editable={canAnnotate && ann.annotating && !ann.viewed}
        tool={ann.tool}
        color={ann.color}
        width={ann.penWidth}
        alpha={ann.alpha}
      />
      {watermark}
    </div>
  );
}
