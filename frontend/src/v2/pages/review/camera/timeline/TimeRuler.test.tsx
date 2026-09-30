// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimeRuler from './TimeRuler';

/** Vue de 1 s sur 200 px : 1 px = 5 ms. 10 fps, donc une frame tous les 100 ms. */
const view = { t0: 0, t1: 1000, width: 200 };
const FPS = 10;

/** Ancre le SVG à une géométrie connue : happy-dom ne mesure rien et ne capture pas le pointeur. */
const anchor = (el: Element) => {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 22 }) as DOMRect;
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
};

function setup(over: Partial<Parameters<typeof TimeRuler>[0]> = {}) {
  const onScrub = vi.fn();
  const { container } = render(
    <TimeRuler view={view} fps={FPS} keyTimes={[0, 500]} playheadT={0} onScrub={onScrub} {...over} />,
  );
  const svg = container.querySelector('svg')!;
  anchor(svg);
  return { svg, onScrub };
}

describe('TimeRuler — scrub', () => {
  it('un appui dans la règle déplace la tête de lecture, snappée à la frame', () => {
    const { svg, onScrub } = setup();
    fireEvent.pointerDown(svg, { button: 0, clientX: 90, pointerId: 1 });
    // 90 px = 450 ms, soit entre deux frames → 500 ms.
    expect(onScrub).toHaveBeenCalledWith(500);
  });

  it('le glissement continue de scruber jusqu’au relâchement', () => {
    const { svg, onScrub } = setup();
    fireEvent.pointerDown(svg, { button: 0, clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 120, pointerId: 1 });
    expect(onScrub).toHaveBeenLastCalledWith(600);
    fireEvent.pointerUp(svg, { clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 160, pointerId: 1 });
    expect(onScrub).toHaveBeenCalledTimes(2);
  });

  it('Alt libère le placement entre deux frames', () => {
    const { svg, onScrub } = setup();
    fireEvent.pointerDown(svg, { button: 0, clientX: 90, pointerId: 1, altKey: true });
    expect(onScrub).toHaveBeenCalledWith(450);
  });

  it('un temps négatif est impossible, même en tirant à gauche de zéro', () => {
    const { svg, onScrub } = setup();
    fireEvent.pointerDown(svg, { button: 0, clientX: -80, pointerId: 1, altKey: true });
    expect(onScrub).toHaveBeenCalledWith(0);
  });
});

describe('TimeRuler — colonnes de clés', () => {
  it('en édition, tirer un losange retime toute la colonne', () => {
    const onMoveColumn = vi.fn();
    const onBeginStroke = vi.fn();
    const { svg } = setup({ editable: true, onMoveColumn, onBeginStroke });
    const diamond = svg.querySelectorAll('path')[1];
    fireEvent.pointerDown(diamond, { button: 0, clientX: 100, pointerId: 1 });
    expect(onBeginStroke).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(svg, { clientX: 140, pointerId: 1 });
    expect(onMoveColumn).toHaveBeenCalledWith(500, 700);
  });

  it('hors édition, le losange n’arme rien et la règle scrube comme ailleurs', () => {
    const onMoveColumn = vi.fn();
    const { svg, onScrub } = setup({ onMoveColumn });
    const diamond = svg.querySelectorAll('path')[1];
    fireEvent.pointerDown(diamond, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 140, pointerId: 1 });
    expect(onMoveColumn).not.toHaveBeenCalled();
    expect(onScrub).toHaveBeenCalledWith(500);
  });
});
