// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WaveformTrack } from './useWaveform';
import { waveformBars } from './waveformData';
import { useT } from '../../../i18n';

/** Une barre tous les ~3 px : assez fin pour voir une syllabe, assez gros pour rester net. */
const PX_PER_BAR = 3;
const MIN_BARS = 32;
const NO_PEAKS = new Uint8Array(0);

/**
 * Forme d'onde audio sous la timeline.
 *
 * Elle rend visible ce qu'aucun compteur ne dit : où le dialogue commence, où il coupe,
 * si le son colle à l'image. Le tracé est dessiné une fois (les crêtes ne changent pas) ;
 * seule la partie déjà lue est repeinte, par découpe — sinon un millier de rectangles
 * seraient reconstruits à chaque frame.
 */
export default function WaveformStrip({
  track,
  duration,
  time,
  onSeek,
}: {
  /** Piste du média — rien n'est rendu tant qu'elle est absente ou masquée. */
  track: WaveformTrack;
  duration: number;
  /** Instant courant (secondes) : borne de la partie déjà lue. */
  time: number;
  onSeek: (t: number) => void;
}) {
  const t = useT();
  const peaks = track.peaks ?? NO_PEAKS;
  const ref = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const count = Math.max(MIN_BARS, Math.min(peaks.length, Math.floor(width / PX_PER_BAR) || MIN_BARS));
  const bars = useMemo(() => waveformBars(peaks, count), [peaks, count]);
  const shapes = useMemo(
    () =>
      bars.map((v, i) => {
        // Hauteur plancher : une barre visible même dans le silence, sinon la piste
        // paraît absente là où elle est simplement calme.
        const h = Math.max(2, v * 96);
        return <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} />;
      }),
    [bars],
  );

  // `useId` contient des caractères interdits dans une référence CSS (`url(#…)`).
  const clipId = `wf-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const progress = duration > 0 ? Math.min(Math.max(time / duration, 0), 1) : 0;

  // Après les hooks, jamais avant : média muet, forme d'onde masquée, durée inconnue.
  if (track.peaks === null || duration <= 0) return null;

  const seekFromEvent = (e: { clientX: number }) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  return (
    <div
      ref={ref}
      className="relative h-8 shrink-0 cursor-pointer select-none overflow-hidden rounded-md border border-border bg-card/60"
      title={t('video.waveform.scrub')}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        scrubbing.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        seekFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (scrubbing.current) seekFromEvent(e);
      }}
      onPointerUp={() => {
        scrubbing.current = false;
      }}
    >
      <svg viewBox={`0 0 ${count} 100`} preserveAspectRatio="none" className="h-full w-full">
        <g className="fill-muted-foreground/40">{shapes}</g>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={progress * count} height="100" />
        </clipPath>
        <g className="fill-primary/80" clipPath={`url(#${clipId})`}>
          {shapes}
        </g>
      </svg>
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-primary"
        style={{ left: `${progress * 100}%` }}
      />
    </div>
  );
}
