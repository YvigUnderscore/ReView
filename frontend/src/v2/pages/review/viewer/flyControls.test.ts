import { describe, expect, it } from 'vitest';
import { FLY_MOVE_MAPPING, moveDirection } from './flyControls';

describe('moveDirection', () => {
  it('mappe les codes physiques ZQSD/WASD + A/E (monter/descendre)', () => {
    expect(moveDirection(new Set(['KeyW']))).toEqual([0, 0, -1]);
    expect(moveDirection(new Set(['KeyS']))).toEqual([0, 0, 1]);
    expect(moveDirection(new Set(['KeyA']))).toEqual([-1, 0, 0]);
    expect(moveDirection(new Set(['KeyD']))).toEqual([1, 0, 0]);
    expect(moveDirection(new Set(['KeyE']))).toEqual([0, 1, 0]); // monter
    expect(moveDirection(new Set(['KeyQ']))).toEqual([0, -1, 0]); // descendre
  });

  it('normalise les diagonales et annule les directions opposées', () => {
    const [x, , z] = moveDirection(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(z).toBeCloseTo(-Math.SQRT1_2);
    expect(moveDirection(new Set(['KeyW', 'KeyS']))).toEqual([0, 0, 0]);
  });

  it('ignore les codes hors mapping', () => {
    expect(moveDirection(new Set(['KeyX', 'Space']))).toEqual([0, 0, 0]);
    expect(Object.keys(FLY_MOVE_MAPPING)).toHaveLength(6);
  });
});
