// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { commonZone, containBox } from './compareFit';
import { CompareFitProvider } from './CompareFitProvider';
import { useFitBox } from '../zoom/useFitBox';

/**
 * The initial complaint: "in side-by-side, the right-hand video is displayed much smaller".
 * Two faults lie behind it, and this file locks in both remedies: the "contain" fit no longer
 * looks at the source resolution, and panes fit into a common area rather than each into its own.
 */
describe('containBox — the source resolution no longer decides the size', () => {
  it('fills the width when the zone is taller than the media', () => {
    expect(containBox({ w: 800, h: 600 }, 16 / 9)).toEqual({ w: 800, h: 450 });
  });

  it('fills the height when the zone is wider than the media', () => {
    const box = containBox({ w: 800, h: 300 }, 16 / 9);
    expect(box.h).toBe(300);
    expect(box.w).toBeCloseTo((300 * 16) / 9, 6);
  });

  it('gives the same box to a low-resolution proxy and to its master', () => {
    // 1080p and its 360p proxy: same aspect ratio, hence exactly the same size on screen.
    // Not 640 × 360 lost in the middle of an 800-wide pane.
    const zone = { w: 800, h: 600 };
    expect(containBox(zone, 1920 / 1080)).toEqual(containBox(zone, 640 / 360));
  });

  it('does not distort: the box keeps the aspect of the media, not that of the zone', () => {
    const box = containBox({ w: 800, h: 300 }, 4 / 3);
    expect(box.w / box.h).toBeCloseTo(4 / 3, 6);
  });

  it('gives a null box as long as nothing is measurable', () => {
    expect(containBox({ w: 0, h: 0 }, 16 / 9)).toEqual({ w: 0, h: 0 });
    expect(containBox({ w: 800, h: 600 }, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('commonZone — the rectangle that fits in all panes', () => {
  it('takes the smallest width and the smallest height', () => {
    expect(
      commonZone([
        { w: 700, h: 600 },
        { w: 720, h: 660 },
      ]),
    ).toEqual({ w: 700, h: 600 });
  });

  it('ignores a pane not yet laid out, which would crush all the others', () => {
    expect(
      commonZone([
        { w: 800, h: 600 },
        { w: 0, h: 0 },
      ]),
    ).toEqual({ w: 800, h: 600 });
  });

  it('returns null when no zone is measured', () => {
    expect(commonZone([])).toBeNull();
    expect(commonZone([{ w: 0, h: 500 }])).toBeNull();
  });
});

/**
 * The panes of a comparison never have the same available height: the master carries the
 * timeline and transport below the image, the B panes a header or a HUD. With each one
 * fitting on its own, the same image was displayed at two sizes.
 *
 * These tests describe the two real geometries: side by side (two columns of equal width)
 * and the 2×2 grid (short cells, where height is the deciding factor).
 */
function Pane({
  name,
  zone,
  resolution,
}: {
  name: string;
  /** Available area of the pane, in pixels. happy-dom does not lay anything out. */
  zone: [number, number];
  /** Media resolution, which gives the aspect ratio (as `loadedmetadata` would). */
  resolution: [number, number];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { box, setAspect } = useFitBox(ref);

  const attach = (el: HTMLDivElement | null) => {
    if (el) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: zone[0] });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: zone[1] });
    }
    ref.current = el;
  };

  useEffect(() => {
    setAspect(resolution[0] / resolution[1]);
  }, [resolution, setAspect]);

  return (
    <div ref={attach} data-testid={name} data-box={box ? `${Math.round(box.w)}×${Math.round(box.h)}` : ''} />
  );
}

const boxOf = (name: string) => screen.getByTestId(name).getAttribute('data-box');

describe('shared fitting of the comparison panes', () => {
  it('side by side: a 360p proxy is displayed at the size of the 1080p master', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[700, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[700, 660]} resolution={[640, 360]} />
      </CompareFitProvider>,
    );
    // 700 wide decides: the box is 700 × 394 on both sides, not 640 × 360 (source size)
    // lost in the middle of the right half.
    expect(boxOf('b')).toBe(boxOf('a'));
    expect(boxOf('a')).toBe('700×394');
  });

  it('2×2 grid: the shortest cell decides, the three panes are the same size', () => {
    render(
      <CompareFitProvider>
        {/* The master's cell loses the height of its timeline and transport. */}
        <Pane name="a" zone={[800, 300]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[800, 400]} resolution={[640, 360]} />
        <Pane name="c" zone={[800, 400]} resolution={[3840, 2160]} />
      </CompareFitProvider>,
    );
    expect(boxOf('a')).toBe('533×300');
    expect(boxOf('b')).toBe('533×300');
    expect(boxOf('c')).toBe('533×300');
  });

  it('same size is not same aspect: a 4:3 media keeps its proportions', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[800, 300]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[800, 400]} resolution={[1440, 1080]} />
      </CompareFitProvider>,
    );
    // Both fit in the same common area (800 × 300) and fill it in height. Each keeps its own
    // aspect ratio: the fit is a "contain", it distorts nothing.
    expect(boxOf('a')).toBe('533×300');
    expect(boxOf('b')).toBe('400×300');
  });

  it('a pane not yet laid out does not shrink the others', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[800, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[0, 0]} resolution={[1920, 1080]} />
      </CompareFitProvider>,
    );
    expect(boxOf('a')).toBe('800×450');
  });

  it('outside a comparison, each pane keeps its own zone', () => {
    render(
      <>
        <Pane name="a" zone={[800, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[400, 600]} resolution={[1920, 1080]} />
      </>,
    );
    expect(boxOf('a')).toBe('800×450');
    expect(boxOf('b')).toBe('400×225');
  });
});
