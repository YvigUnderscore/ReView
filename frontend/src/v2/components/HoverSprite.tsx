// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/** Thumbnail sprite: `cols`×`rows` grid, `count` thumbnails (42.A, №78). */
export interface SpriteData {
  url: string;
  count: number;
  cols: number;
  rows: number;
}

/**
 * Animated hover preview (42.A, №78): overlays the card and scrolls the thumbnails
 * of the sprite while the mouse is over it. Transparent at rest, so it lets the
 * static thumbnail below show through. Driven on its own (it is on top, so it receives the hover).
 *
 * The mosaic only enters the style **after** a first hover. A CSS background is
 * downloaded as soon as the element enters the render tree. `opacity: 0` changes nothing,
 * only `display: none` would: a page of a hundred cards called for a hundred contact sheets
 * of several hundred kilobytes for a hover that might never happen,
 * and cancelled the `loading="lazy"` set right beside it on the static thumbnail.
 */
export default function HoverSprite({ sprite }: { sprite: SpriteData }) {
  const [hovered, setHovered] = useState(false);
  const [frame, setFrame] = useState(0);
  // Armed on the first hover, and never disarmed: the second hover must be instantaneous.
  const [armed, setArmed] = useState(false);
  // The mosaic is only revealed once decoded. Setting the URL beforehand would make
  // the image appear in strips under the fade, where the former code had it ready in advance.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!armed) return;
    // Preload off the DOM: this IS the network request of the mosaic. The CSS background
    // set afterwards hits the browser cache, so it triggers no second request.
    const img = new Image();
    const reveal = () => setReady(true);
    img.addEventListener('load', reveal);
    img.src = sprite.url;
    return () => img.removeEventListener('load', reveal);
  }, [armed, sprite.url]);

  useEffect(() => {
    if (!hovered || !ready) return;
    const t = window.setInterval(() => setFrame((f) => (f + 1) % sprite.count), 180);
    return () => window.clearInterval(t);
  }, [hovered, ready, sprite.count]);

  const col = frame % sprite.cols;
  const row = Math.floor(frame / sprite.cols);
  // Position in % (0→100) so that each tile fills the card whatever its size.
  const posX = sprite.cols > 1 ? (col / (sprite.cols - 1)) * 100 : 0;
  const posY = sprite.rows > 1 ? (row / (sprite.rows - 1)) * 100 : 0;
  const shown = hovered && ready;

  return (
    <div
      onMouseEnter={() => {
        setArmed(true);
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setFrame(0);
      }}
      aria-hidden
      className="absolute inset-0 transition-opacity duration-150"
      style={{
        opacity: shown ? 1 : 0,
        backgroundImage: ready ? `url(${sprite.url})` : undefined,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sprite.cols * 100}% ${sprite.rows * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  );
}
