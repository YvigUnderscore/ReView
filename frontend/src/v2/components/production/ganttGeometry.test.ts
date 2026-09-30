// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  DAY,
  MIN_BAR_PCT,
  barBox,
  ganttTicks,
  ganttWindow,
  groupBars,
  markerLeft,
  spanOf,
  visibleBars,
  type GanttWindow,
} from './ganttGeometry';

/**
 * Le défaut constaté à l'écran : une barre à `left: -140%`, peinte par-dessus la colonne
 * des libellés. Ces tests verrouillent l'invariant qui l'interdit — rien ne sort de
 * [0, 100] — et la contrepartie : ce qui dépasse reste visible, et le dit.
 */

/** Fenêtre de référence : dix jours à partir du 10 janvier 2026. */
const T0 = Date.UTC(2026, 0, 10);
const win: GanttWindow = { min: T0, span: 10 * DAY };

const inside = (box: { left: number; width: number }) =>
  box.left >= 0 && box.width > 0 && box.left + box.width <= 100 + 1e-9;

describe('barBox — bornage à la fenêtre', () => {
  it('place une barre entièrement contenue à sa place exacte', () => {
    const box = barBox(T0 + 2 * DAY, T0 + 4 * DAY, win);
    expect(box).toMatchObject({ left: 20, width: 20, clippedStart: false, clippedEnd: false, visible: true });
  });

  it('coupe à gauche une tâche commencée avant la fenêtre, au lieu d’un pourcentage négatif', () => {
    const box = barBox(T0 - 30 * DAY, T0 + 3 * DAY, win);
    expect(box.left).toBe(0);
    expect(box.width).toBe(30);
    expect(box.clippedStart).toBe(true);
    expect(box.clippedEnd).toBe(false);
    expect(inside(box)).toBe(true);
  });

  it('coupe à droite une tâche qui finit après la fenêtre', () => {
    const box = barBox(T0 + 8 * DAY, T0 + 40 * DAY, win);
    expect(box.left).toBe(80);
    expect(box.width).toBe(20);
    expect(box.clippedEnd).toBe(true);
    expect(box.clippedStart).toBe(false);
    expect(inside(box)).toBe(true);
  });

  it('couvre toute la piste quand la tâche dépasse des deux côtés', () => {
    const box = barBox(T0 - 100 * DAY, T0 + 100 * DAY, win);
    expect(box).toMatchObject({ left: 0, width: 100, clippedStart: true, clippedEnd: true, visible: true });
  });

  it('donne au moins une largeur plancher à une tâche d’un seul jour', () => {
    const box = barBox(T0 + 5 * DAY, T0 + 5 * DAY, win);
    expect(box.width).toBe(MIN_BAR_PCT);
    expect(box.left).toBe(50);
    expect(inside(box)).toBe(true);
  });

  it('garde le plancher dans le cadre pour une tâche collée au bord droit', () => {
    const box = barBox(T0 + 10 * DAY, T0 + 10 * DAY, win);
    expect(box.left).toBe(100 - MIN_BAR_PCT);
    expect(box.width).toBe(MIN_BAR_PCT);
    expect(inside(box)).toBe(true);
  });

  it('déclare invisible une tâche entièrement hors fenêtre, sans largeur à peindre', () => {
    const before = barBox(T0 - 40 * DAY, T0 - 30 * DAY, win);
    const after = barBox(T0 + 30 * DAY, T0 + 40 * DAY, win);
    expect(before).toMatchObject({ visible: false, width: 0, clippedStart: true });
    expect(after).toMatchObject({ visible: false, width: 0, clippedEnd: true });
    expect(before.left).toBeGreaterThanOrEqual(0);
    expect(after.left).toBeLessThanOrEqual(100);
  });

  it('ne sort jamais du cadre, quelles que soient les bornes', () => {
    for (const startDays of [-500, -11, -1, 0, 3, 9.5, 10, 99]) {
      for (const lengthDays of [0, 0.2, 1, 7, 10, 400]) {
        const box = barBox(T0 + startDays * DAY, T0 + (startDays + lengthDays) * DAY, win);
        if (!box.visible) continue;
        expect(inside(box)).toBe(true);
      }
    }
  });

  it('supporte une fenêtre dégénérée sans diviser par zéro', () => {
    const box = barBox(T0, T0, { min: T0, span: 0 });
    expect(Number.isFinite(box.left)).toBe(true);
    expect(Number.isFinite(box.width)).toBe(true);
  });
});

describe('spanOf', () => {
  it('tient une borne manquante par l’autre', () => {
    expect(spanOf({ startDate: '2026-01-10T00:00:00.000Z', dueDate: null })).toMatchObject({
      start: T0,
      end: T0,
    });
    expect(spanOf({ startDate: null, dueDate: '2026-01-10T00:00:00.000Z' })).toMatchObject({
      start: T0,
      end: T0,
    });
  });

  it('ne rend rien sans aucune date', () => {
    expect(spanOf({ startDate: null, dueDate: null })).toBeNull();
  });

  it('remet d’aplomb deux bornes inversées', () => {
    const bar = spanOf({ startDate: '2026-01-20T00:00:00.000Z', dueDate: '2026-01-10T00:00:00.000Z' });
    expect(bar?.start).toBe(T0);
    expect(bar?.end).toBe(Date.UTC(2026, 0, 20));
  });
});

describe('ganttWindow et graduations', () => {
  const bars = [
    { start: T0 - 50 * DAY, end: T0 + 2 * DAY },
    { start: T0 + 1 * DAY, end: T0 + 5 * DAY },
  ];

  it('retient les bornes demandées quand les données les débordent', () => {
    const w = ganttWindow(bars, T0, T0 + 10 * DAY);
    expect(w).toEqual({ min: T0, span: 5 * DAY });
  });

  it('se resserre sur les données quand elles n’occupent pas la période', () => {
    const w = ganttWindow([{ start: T0 + 2 * DAY, end: T0 + 4 * DAY }], T0, T0 + 30 * DAY);
    expect(w).toEqual({ min: T0 + 2 * DAY, span: 2 * DAY });
  });

  it('garde une durée non nulle sur une seule journée', () => {
    expect(ganttWindow([{ start: T0, end: T0 }], T0, T0)?.span).toBe(DAY);
  });

  it('ne rend rien sans barre', () => {
    expect(ganttWindow([], T0, T0 + DAY)).toBeNull();
  });

  it('produit des graduations bornes incluses', () => {
    expect(ganttTicks(win)).toEqual([T0, T0 + 2.5 * DAY, T0 + 5 * DAY, T0 + 7.5 * DAY, T0 + 10 * DAY]);
  });

  it('ne place le repère du jour que dans la fenêtre', () => {
    expect(markerLeft(T0 + 5 * DAY, win)).toBe(50);
    expect(markerLeft(T0 - DAY, win)).toBeNull();
    expect(markerLeft(T0 + 11 * DAY, win)).toBeNull();
  });
});

describe('visibleBars et groupBars', () => {
  it('garde les barres qui débordent et écarte celles qui sont ailleurs', () => {
    const bars = [
      { task: { sequenceCode: 'SQ01' }, start: T0 - 40 * DAY, end: T0 + DAY },
      { task: { sequenceCode: 'SQ01' }, start: T0 - 40 * DAY, end: T0 - 20 * DAY },
    ];
    expect(visibleBars(bars, T0, T0 + 10 * DAY)).toHaveLength(1);
  });

  it('range les sans-sequence en dernier et ordonne chaque piste', () => {
    const bars: { task: { sequenceCode: string | null }; start: number; end: number }[] = [
      { task: { sequenceCode: null }, start: T0, end: T0 },
      { task: { sequenceCode: 'SQ02' }, start: T0 + 5 * DAY, end: T0 + 6 * DAY },
      { task: { sequenceCode: 'SQ02' }, start: T0 + DAY, end: T0 + 2 * DAY },
    ];
    const groups = groupBars(bars, 'No sequence');
    expect(groups.map((g) => g.label)).toEqual(['SQ02', 'No sequence']);
    expect(groups[0].bars.map((b) => b.start)).toEqual([T0 + DAY, T0 + 5 * DAY]);
  });
});
