// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WaveformTrack } from './useWaveform';
import { waveformBars } from './waveformData';
import { useT } from '@/v2/i18n';

/** One bar every ~3 px: thin enough to show a syllable, thick enough to stay crisp. */
const PX_PER_BAR = 3;
const MIN_BARS = 32;
const NO_PEAKS = new Uint8Array(0);

/**
 * Audio waveform under the timeline.
 *
 * It shows what no counter says: where the dialogue starts, where it cuts, whether the sound
 * sticks to the picture. The trace is drawn once (the peaks never change); only the part
 * already played is repainted, by clipping — otherwise about a thousand rectangles would be
 * rebuilt on every frame.
 */
export default function WaveformStrip({
  track,
  duration,
  time,
  onSeek,
}: {
  /** Media track — nothing is rendered while it is absent or hidden. */
  track: WaveformTrack;
  duration: number;
  /** Current time (seconds): boundary of the part already played. */
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
        // Minimum height: a visible bar even in silence, otherwise the track
        // looks absent where it is simply quiet.
        const h = Math.max(2, v * 96);
        return <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} />;
      }),
    [bars],
  );

  // `useId` contains characters not allowed in a CSS reference (`url(#…)`).
  const clipId = `wf-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const progress = duration > 0 ? Math.min(Math.max(time / duration, 0), 1) : 0;

  // After the hooks, never before: silent media, hidden waveform, unknown duration.
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
