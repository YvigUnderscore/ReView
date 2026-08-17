// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns2, Flame, SplitSquareHorizontal, X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';
import { HEATMAP_CSS_FILTER, nextGain, useDiffDraw } from './diffRender';
import { useT } from '../../i18n';

/**
 * LUT fausses couleurs (noir → bleu → vert → jaune → rouge) : luminance du diff passée
 * dans des tables par canal. Montée une fois par overlay diff (id global unique),
 * référencée en filtre **CSS** sur l'élément canvas (HEATMAP_CSS_FILTER) — Chrome
 * ignore les filtres SVG référencés dans `ctx.filter`.
 */
function HeatmapLut() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="diff-heatmap-lut" colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
        />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0 0 0 1 1" />
          <feFuncG type="table" tableValues="0 0.6 1 1 0" />
          <feFuncB type="table" tableValues="0.4 1 0.2 0 0" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

/**
 * Mode différence A/B (34.E) : |A − B| amplifié (gain cliquable ×1→×16) + option
 * heatmap, rendu canvas côté client. Variante vidéo (overlay sur le lecteur maître,
 * B synchronisée cachée) et variante image (remplace la visionneuse).
 */

function DiffHud({
  gain,
  onGain,
  heatmap,
  onHeatmap,
  onSide,
  onWipe,
  onClose,
}: {
  gain: number;
  onGain: () => void;
  heatmap: boolean;
  onHeatmap: () => void;
  onSide: () => void;
  onWipe: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-md border border-border bg-card/90 px-1 py-0.5 backdrop-blur">
      <button
        onClick={onGain}
        title={t('review.compare.diffGain')}
        className="rounded px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-secondary"
      >
        ×{gain}
      </button>
      <button
        onClick={onHeatmap}
        title={heatmap ? t('diff.real') : t('diff.heatmap')}
        className={`rounded p-1 hover:bg-secondary ${heatmap ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Flame size={14} />
      </button>
      <button
        onClick={onWipe}
        title={t('review.compare.toWipe')}
        className="rounded p-1.5 hover:bg-secondary"
      >
        <SplitSquareHorizontal size={14} />
      </button>
      <button
        onClick={onSide}
        title={t('review.compare.sideBySide')}
        className="rounded p-1.5 hover:bg-secondary"
      >
        <Columns2 size={14} />
      </button>
      <button
        onClick={onClose}
        title={t('review.compare.close')}
        className="rounded p-1.5 hover:bg-secondary"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Overlay diff **vidéo** : à placer dans le conteneur `relative` de la vidéo A. */
export function VideoDiffOverlay({
  compareId,
  masterRef,
  onClose,
  onSide,
  onWipe,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onSide: () => void;
  onWipe: () => void;
}) {
  const slaveRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [gain, setGain] = useState(4);
  const [heatmap, setHeatmap] = useState(false);

  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const src = mediaQ.data?.proxyUrl ?? mediaQ.data?.url;

  useVideoSync(masterRef, slaveRef, ready);
  const getA = useCallback(() => masterRef.current, [masterRef]);
  const getB = useCallback(() => (ready ? slaveRef.current : null), [ready]);
  useDiffDraw(canvasRef, getA, getB, gain);

  return (
    <div className="absolute inset-0 z-20 select-none bg-black">
      {src && (
        <video
          ref={slaveRef}
          src={src}
          muted
          playsInline
          crossOrigin="anonymous"
          onLoadedMetadata={() => setReady(true)}
          className="hidden"
        />
      )}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        style={heatmap ? { filter: HEATMAP_CSS_FILTER } : undefined}
      />
      <HeatmapLut />
      <DiffHud
        gain={gain}
        onGain={() => setGain(nextGain)}
        heatmap={heatmap}
        onHeatmap={() => setHeatmap((h) => !h)}
        onSide={onSide}
        onWipe={onWipe}
        onClose={onClose}
      />
      {mediaQ.error && (
        <p className="absolute bottom-2 left-2 text-xs text-destructive">{mediaQ.error.message}</p>
      )}
    </div>
  );
}

/** Diff **image** : remplace la visionneuse pendant la comparaison (comme le wipe). */
export function ImageDiffOverlay({
  aUrl,
  compareId,
  onClose,
  onSide,
  onWipe,
}: {
  aUrl: string;
  compareId: number;
  onClose: () => void;
  onSide: () => void;
  onWipe: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gain, setGain] = useState(4);
  const [heatmap, setHeatmap] = useState(false);
  const [imgA, setImgA] = useState<HTMLImageElement | null>(null);
  const [imgB, setImgB] = useState<HTMLImageElement | null>(null);

  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const bUrl = mediaQ.data?.url;

  // Chargement des deux sources hors DOM (crossOrigin : le canvas reste exportable).
  useEffect(() => loadImage(aUrl, setImgA), [aUrl]);
  useEffect(() => (bUrl ? loadImage(bUrl, setImgB) : undefined), [bUrl]);

  const getA = useCallback(() => imgA, [imgA]);
  const getB = useCallback(() => imgB, [imgB]);
  useDiffDraw(canvasRef, getA, getB, gain);

  return (
    <div className={VIEWER_ZONE}>
      <div className="absolute inset-0 select-none bg-black">
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={heatmap ? { filter: HEATMAP_CSS_FILTER } : undefined}
        />
        <HeatmapLut />
        <DiffHud
          gain={gain}
          onGain={() => setGain(nextGain)}
          heatmap={heatmap}
          onHeatmap={() => setHeatmap((h) => !h)}
          onSide={onSide}
          onWipe={onWipe}
          onClose={onClose}
        />
        {mediaQ.error && (
          <p className="absolute bottom-2 left-2 text-xs text-destructive">{mediaQ.error.message}</p>
        )}
      </div>
    </div>
  );
}

/** Charge une image détachée (annulable) pour le rendu canvas. */
function loadImage(url: string, set: (img: HTMLImageElement | null) => void) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => set(img);
  img.src = url;
  return () => {
    img.onload = null;
    set(null);
  };
}
