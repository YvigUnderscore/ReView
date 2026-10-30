// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Simulated layout, for components that MEASURE.
 *
 * happy-dom lays nothing out: `scrollHeight` and `clientHeight` are zero on every
 * node of the tree. A component that decides based on its own overflow (the clamping of
 * comments, which stopped estimating from the character count) therefore checks
 * nothing, and a test that sticks to the bare DOM no longer verifies what it announces.
 *
 * The double gives the document the simplest metric that reproduces the defect: a
 * width in CHARACTERS per line, a fixed line height, and the ceiling declared by the
 * clamping classes (`line-clamp-N`, `max-h-32`). It is the width that changes from one surface
 * to another (a 15 rem anchored card against the comment thread), and that is exactly
 * what a constant character count could not tell apart.
 *
 * This is not a rendering engine: words only break at the character, and only the two
 * clamping classes of the application cap a height. A test that needs more
 * should go through the browser.
 */

/** Height of a line, in pixels: a round value, so the counts are easy to read. */
export const STUB_LINE_HEIGHT = 16;

/** Visible height of the default clamp (`max-h-32`), in pixels. */
const MAX_H_32 = 128;

/** Height ceiling declared by the clamping classes, or `null` if the element has none. */
function heightCap(el: Element, lineHeight: number): number | null {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  const clamp = classes.find((c) => /^line-clamp-\d+$/.test(c));
  if (clamp) return Number(clamp.slice('line-clamp-'.length)) * lineHeight;
  return classes.includes('max-h-32') ? MAX_H_32 : null;
}

/** Lines occupied by a text at this width, line breaks included. */
function wrappedLines(text: string, charsPerLine: number): number {
  return text
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * Installs the metric and returns the function that removes it. To be called BEFORE rendering: the
 * measure is taken in a layout effect, so during rendering.
 */
export function stubLayoutMetrics({
  charsPerLine,
  lineHeight = STUB_LINE_HEIGHT,
}: {
  charsPerLine: number;
  lineHeight?: number;
}): () => void {
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element): number {
      return wrappedLines(this.textContent ?? '', charsPerLine) * lineHeight;
    },
  });
  // Without a ceiling, the element shows all its content: this is the case of the whole tree except the
  // single clamped element, and that is what makes only it measured as overflowing.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      const cap = heightCap(this, lineHeight);
      return cap === null ? this.scrollHeight : Math.min(this.scrollHeight, cap);
    },
  });

  return () => {
    if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  };
}
