/**
 * Watermark spectateur (35.B) : tuile SVG répétée en fond (data-URI) — bien plus léger
 * que des centaines de nœuds DOM, et insensible au zoom du média en dessous.
 */

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Tuile SVG du filigrane (texte incliné) encodée pour `background-image`. */
export function watermarkTileUrl(text: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'>` +
    `<text x='210' y='130' text-anchor='middle' transform='rotate(-30 210 130)' ` +
    `font-family='system-ui, sans-serif' font-size='19' fill='white'>${escapeXml(text)}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
