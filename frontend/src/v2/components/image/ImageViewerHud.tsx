// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Expand, Info } from 'lucide-react';
import { formatBytes } from '../../../lib/formatBytes';
import { useT } from '../../i18n';

/** Contrôles de zoom de la visionneuse d'image et panneau d'infos repliable. */
export default function ImageViewerHud({
  scale,
  natural,
  info,
  onZoom,
  onActualSize,
  onFit,
  onFullscreen,
}: {
  scale: number;
  natural: { w: number; h: number } | null;
  info?: { format?: string | null; sizeBytes?: number | null };
  onZoom: (factor: number) => void;
  onActualSize: () => void;
  onFit: () => void;
  onFullscreen: () => void;
}) {
  const t = useT();
  const [showInfo, setShowInfo] = useState(false);
  const size = info?.sizeBytes == null ? null : formatBytes(info.sizeBytes);

  return (
    <>
      {showInfo && (
        <div className="absolute right-3 top-3 min-w-[10rem] rounded-md border border-border bg-card/95 p-2 text-xs backdrop-blur">
          <div className="mb-1 font-medium text-foreground">{t('imageViewer.info')}</div>
          <dl className="space-y-0.5 text-muted-foreground">
            {natural && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.resolution')}</dt>
                <dd className="tabular-nums text-foreground">
                  {natural.w} × {natural.h}
                </dd>
              </div>
            )}
            {info?.format && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.format')}</dt>
                <dd className="text-foreground">{info.format}</dd>
              </div>
            )}
            {size && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.size')}</dt>
                <dd className="text-foreground">{size}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur">
        <button
          onClick={() => onZoom(1 / 1.25)}
          title={t('imageViewer.zoomOut')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <ZoomOut size={16} />
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => onZoom(1.25)}
          title={t('imageViewer.zoomIn')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={onActualSize}
          title={t('imageViewer.actualSize')}
          className="rounded px-1.5 py-1 text-xs font-medium hover:bg-muted"
        >
          1:1
        </button>
        <button onClick={onFit} title={t('imageViewer.fit')} className="rounded p-1.5 hover:bg-muted">
          <Maximize size={16} />
        </button>
        <button
          onClick={onFullscreen}
          title={t('imageViewer.fullscreen')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <Expand size={16} />
        </button>
        <button
          onClick={() => setShowInfo((v) => !v)}
          title={t('imageViewer.info')}
          aria-pressed={showInfo}
          className={`rounded p-1 hover:bg-muted ${showInfo ? 'text-primary' : ''}`}
        >
          <Info size={16} />
        </button>
      </div>
    </>
  );
}
