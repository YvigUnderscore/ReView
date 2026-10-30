// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { watermarkTileUrl } from '../lib/watermark';

/**
 * Deterrent watermark bearing the viewer's name (35.B): placed above the viewers.
 * `mix-blend-difference` keeps it readable on light and dark backgrounds alike;
 * non-interactive (pointer-events-none), ignored by screen readers.
 */
export default function WatermarkOverlay({ text, opacity = 0.08 }: { text: string; opacity?: number }) {
  const tile = useMemo(() => watermarkTileUrl(text), [text]);
  if (!text.trim()) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-40 mix-blend-difference"
      style={{ opacity, backgroundImage: tile }}
    />
  );
}
