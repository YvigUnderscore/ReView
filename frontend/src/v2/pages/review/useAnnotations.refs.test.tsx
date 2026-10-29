// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnnotations, type Annotations } from './useAnnotations';
import { REF_POS_LIMIT, type ViewerBands } from './referenceBox';
import type { Shape } from '../../components/AnnotationCanvas';

/**
 * Five defects locked down here:
 * - the pasted reference was placed outside the frame (x = 1.05), hence invisible;
 * - the fix then pasted it **onto** the image by default: it now lands in the letterbox band whenever
 *   the viewer leaves one, side or horizontal;
 * - moving stayed bounded to that band, hence impossible on the sides of a wide plane: the reference
 *   now lands exactly where it is dropped;
 * - moving stacked one undo step **per mouse movement**: Ctrl+Z only restored one pixel;
 * - no Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z existed in the image review.
 */
const DATA_URL = 'data:image/png;base64,AA';
/** What the overlay publishes when the viewer is wider than the media (side bands). */
const SIDE_BANDS = { left: 0.5, right: 0.5, top: 0, bottom: 0 };
/** And when the media is wider than the viewer (horizontal letterbox). */
const FLAT_BANDS = { left: 0, right: 0, top: 0.5, bottom: 0.5 };
const shape = (id: string, x = 0): Shape => ({ id, type: 'rect', color: '#fff', width: 3, x, y: 0 });

/**
 * Mounts the composer and pastes a reference into it, as Ctrl+V does on the canvas. `bands` simulates
 * what the overlay measures of the viewer; by default nothing is measured (the media fills the whole
 * area), and the reference then falls back to a corner of the media.
 */
function composer(withRef = true, bands?: ViewerBands) {
  const { result } = renderHook(() => useAnnotations());
  const ann = () => result.current;
  if (bands) act(() => ann().setRefBands(bands));
  if (withRef) act(() => ann().addStagedRef(DATA_URL));
  return { ann, ref: () => ann().stagedRefs[0] };
}

const ctrl = (key: string, shift = false) => {
  fireEvent.keyDown(document.body, { key, ctrlKey: true, shiftKey: shift });
};

const drag = (ann: () => Annotations, key: string, xs: number[]) => {
  for (const x of xs) act(() => ann().updateStagedRef(key, { x }, 'geste'));
};

describe('pasted reference', () => {
  it('falls back inside the frame, visible, when the media fills the whole viewer', () => {
    const { ref } = composer();
    expect(ref().x).toBeGreaterThan(0);
    expect(ref().x + ref().width).toBeLessThanOrEqual(1);
    expect(ref().y).toBeLessThan(0.5);
  });

  it('arms the reference move tool, not the drawing one', () => {
    const { ann } = composer(false);
    expect(ann().tool).toBe('draw');
    act(() => ann().addStagedRef(DATA_URL));
    expect(ann().tool).toBe('ref');
  });

  it('hands control back to the drawing tool from before the paste', () => {
    const { ann } = composer(false);
    act(() => ann().setTool('arrow'));
    act(() => ann().addStagedRef(DATA_URL));
    act(() => ann().exitRefTool());
    expect(ann().tool).toBe('arrow');
  });

  it('lands BESIDE the media when the viewer leaves a band', () => {
    const { ref } = composer(true, SIDE_BANDS);
    expect(ref().x).toBeGreaterThanOrEqual(1);
  });

  it('lands BELOW the media when the letterbox is horizontal', () => {
    const { ref } = composer(true, FLAT_BANDS);
    expect(ref().y).toBeGreaterThan(1);
  });

  it('lands exactly where it is dropped, inside the frame as well as outside', () => {
    const { ann, ref } = composer(true, SIDE_BANDS);
    act(() => ann().updateStagedRef(ref().key, { x: -0.4, y: 0.2 }, 'geste'));
    expect(ref().x).toBeCloseTo(-0.4);
    expect(ref().y).toBeCloseTo(0.2);
  });

  it('goes out to the sides even when the letterbox is horizontal', () => {
    const { ann, ref } = composer(true, FLAT_BANDS);
    act(() => ann().updateStagedRef(ref().key, { x: 1.6, y: -0.7 }, 'geste'));
    expect(ref().x).toBeCloseTo(1.6);
    expect(ref().y).toBeCloseTo(-0.7);
  });

  it('lands outside the frame even when no band is measured', () => {
    const { ann, ref } = composer();
    act(() => ann().updateStagedRef(ref().key, { x: 1.4, y: 1.4 }, 'geste'));
    expect(ref().x).toBeCloseTo(1.4);
    expect(ref().y).toBeCloseTo(1.4);
  });

  it('stops at the ceiling the server accepts, so as not to lose the send', () => {
    const { ann, ref } = composer(true, SIDE_BANDS);
    act(() => ann().updateStagedRef(ref().key, { x: 9, y: -9 }, 'geste'));
    expect(ref().x).toBe(REF_POS_LIMIT);
    expect(ref().y).toBe(-REF_POS_LIMIT);
  });
});

describe('one gesture = one undo step', () => {
  it('undoes the whole drag of a reference, not its last pixel', () => {
    const { ann, ref } = composer();
    const start = ref().x;
    drag(ann, ref().key, [0.2, 0.3, 0.4]);
    expect(ref().x).toBeCloseTo(0.4);

    act(() => ann().undo());
    expect(ref().x).toBeCloseTo(start);
    expect(ann().stagedRefs).toHaveLength(1);
  });

  it('undoes the whole drag of a shape, not its last pixel', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    act(() => ann().setShapes([shape('a')]));
    for (const x of [0.1, 0.2, 0.3]) act(() => ann().setShapes([shape('a', x)], 'glisser'));

    act(() => ann().undo());
    expect(ann().annot[0].x).toBe(0);
    expect(ann().annot).toHaveLength(1);
  });

  it('separates two distinct gestures', () => {
    const { ann, ref } = composer();
    act(() => ann().updateStagedRef(ref().key, { x: 0.2 }, 'g1'));
    act(() => ann().updateStagedRef(ref().key, { x: 0.5 }, 'g2'));
    act(() => ann().undo());
    expect(ref().x).toBeCloseTo(0.2);
  });
});

describe('annotation keyboard shortcuts', () => {
  it('Ctrl+Z undoes the whole gesture, Ctrl+Shift+Z redoes it', () => {
    const { ann, ref } = composer();
    const start = ref().x;
    drag(ann, ref().key, [0.2, 0.45]);

    act(() => ctrl('z'));
    expect(ref().x).toBeCloseTo(start);
    act(() => ctrl('Z', true));
    expect(ref().x).toBeCloseTo(0.45);
  });

  it('Ctrl+Y also redoes', () => {
    const { ann, ref } = composer();
    drag(ann, ref().key, [0.45]);
    act(() => ctrl('z'));
    act(() => ctrl('y'));
    expect(ref().x).toBeCloseTo(0.45);
  });

  it('also undoes shapes', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    act(() => ann().setShapes([shape('a')]));
    act(() => ctrl('z'));
    expect(ann().annot).toHaveLength(0);
  });

  it('lets the shortcut through when there is nothing to undo', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not seize the keyboard in a text field', () => {
    const { ann, ref } = composer();
    drag(ann, ref().key, [0.45]);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    });
    expect(ref().x).toBeCloseTo(0.45);
    input.remove();
  });
});
