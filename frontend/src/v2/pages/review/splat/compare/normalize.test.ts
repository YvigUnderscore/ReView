import { describe, expect, it } from 'vitest';
import { normalizationFor } from './normalize';

describe('normalizationFor — unification des tailles A/B par bbox (11.H)', () => {
  it('échelle = ratio des rayons, centre recalé sur la référence', () => {
    // Référence : rayon 2 centrée en (1, 0, 0) ; frère : rayon 8 centré en (4, 4, 0).
    const n = normalizationFor(2, [1, 0, 0], 8, [4, 4, 0])!;
    expect(n.scale).toBeCloseTo(0.25);
    // centre_frère × 0.25 + offset = centre_référence → offset = (1-1, 0-1, 0-0)
    expect(n.offset[0]).toBeCloseTo(0);
    expect(n.offset[1]).toBeCloseTo(-1);
    expect(n.offset[2]).toBeCloseTo(0);
  });

  it('identité quand les deux splats ont déjà la même taille et le même centre', () => {
    const n = normalizationFor(3, [0, 0, 0], 3, [0, 0, 0])!;
    expect(n.scale).toBeCloseTo(1);
    expect(n.offset).toEqual([0, 0, 0]);
  });

  it('null si un rayon est dégénéré (0, négatif ou non fini)', () => {
    expect(normalizationFor(0, [0, 0, 0], 2, [0, 0, 0])).toBeNull();
    expect(normalizationFor(2, [0, 0, 0], 0, [0, 0, 0])).toBeNull();
    expect(normalizationFor(NaN, [0, 0, 0], 2, [0, 0, 0])).toBeNull();
  });
});
