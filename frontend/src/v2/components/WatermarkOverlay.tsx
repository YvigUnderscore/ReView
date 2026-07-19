import { useMemo } from 'react';
import { watermarkTileUrl } from '../lib/watermark';

/**
 * Filigrane dissuasif au nom du spectateur (35.B) — posé au-dessus des viewers.
 * `mix-blend-difference` le rend lisible sur fonds clairs comme sombres ;
 * non interactif (pointer-events-none), ignoré des lecteurs d'écran.
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
