// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ClientUnavailable from './ClientUnavailable';
import type { Annotations } from '../review/useAnnotations';
import { VIEWER_ZONE } from '../review/reviewTypes';
import { useT } from '../../i18n';

/**
 * Image branch of the client page: the review viewer, not a bare `<img>`.
 *
 * The old version placed the image straight into the viewer area with no measured
 * container, so there was nowhere to put an overlay whose 0..1 coordinates land on the
 * right pixel. `ImageReviewViewer` already handles fit, zoom/pan and the annotation canvas
 * **inside the transformed plane**: drawing and image undergo the same transform, so the
 * annotation stays pixel-aligned at any zoom.
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
        // A selected comment's annotation takes precedence over the draft: we show what the
        // studio shows, we do not draw on top of it.
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
