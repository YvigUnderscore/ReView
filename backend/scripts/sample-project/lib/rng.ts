// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Générateur pseudo-aléatoire **déterministe**.
 *
 * Le jeu de démonstration doit être reproductible : deux exécutions produisent le même
 * projet, sinon on ne peut ni le documenter, ni s'y référer dans une capture d'écran, ni
 * comparer deux relances. `Math.random` est donc proscrit — chaque tirage part d'une graine
 * dérivée du nom de l'élément concerné.
 */

/** Hachage 32 bits d'une chaîne (FNV-1a) : la graine d'un plan est son code. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  /** Réel dans [0, 1). */
  next(): number;
  /** Entier dans [min, max]. */
  int(min: number, max: number): number;
  /** Un élément du tableau. */
  pick<T>(items: readonly T[]): T;
  /** `count` éléments distincts, dans l'ordre du tableau. */
  sample<T>(items: readonly T[], count: number): T[];
  /** Vrai avec la probabilité donnée. */
  chance(probability: number): boolean;
}

/** Mulberry32 : court, rapide, et suffisant pour peupler un jeu de démonstration. */
export function makeRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? seedFrom(seed) : seed) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick on empty list');
    return items[int(0, items.length - 1)]!;
  };
  return {
    next,
    int,
    pick,
    chance: (probability: number) => next() < probability,
    sample: <T>(items: readonly T[], count: number): T[] => {
      const indices = items.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [indices[i], indices[j]] = [indices[j]!, indices[i]!];
      }
      return indices
        .slice(0, Math.min(count, items.length))
        .sort((a, b) => a - b)
        .map((i) => items[i]!);
    },
  };
}
