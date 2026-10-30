// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transformed image, overlaid on the original **in the zoomed plane** of the viewer: it occupies
 * exactly the image box, so it follows zoom, pan and fullscreen without the viewer having to know
 * that color management exists.
 *
 * Purely decorative for accessibility (`alt=""`): it shows the same image as the one already
 * announced underneath, with another display transform.
 */
export default function DisplayTransformOverlay({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
    />
  );
}
