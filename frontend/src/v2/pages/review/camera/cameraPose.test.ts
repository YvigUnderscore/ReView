import { describe, expect, it } from 'vitest';
import { cameraPoseFromView } from './cameraPose';

describe('cameraPoseFromView', () => {
  const base = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };

  it('conserve position/cible et les champs présents (dont aspect)', () => {
    const pose = cameraPoseFromView({ ...base, fov: 50, aspect: 1.777, roll: 0.2 });
    expect(pose).toEqual({ ...base, fov: 50, aspect: 1.777, roll: 0.2 });
  });

  it('omet les champs absents (pas de clés fov/aspect/roll indéfinies)', () => {
    const pose = cameraPoseFromView(base);
    expect(pose).toEqual(base);
    expect('aspect' in pose).toBe(false);
    expect('roll' in pose).toBe(false);
  });
});
