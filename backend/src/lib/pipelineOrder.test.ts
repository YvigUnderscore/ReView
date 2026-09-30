// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { departmentRank, pickMostAdvanced, groupByDepartment } from './pipelineOrder';
import type { Department } from './projectSettings';

const PIPE: Department[] = [
  { key: 'LAYOUT', name: 'Layout' },
  { key: 'ANIMATION', name: 'Animation' },
  { key: 'FX', name: 'FX' },
  { key: 'LIGHTING', name: 'Lighting' },
  { key: 'COMPOSITING', name: 'Compositing' },
];

const at = (iso: string) => new Date(iso);

describe('departmentRank', () => {
  it('rend la position dans le pipe', () => {
    expect(departmentRank(PIPE, 'LAYOUT')).toBe(0);
    expect(departmentRank(PIPE, 'COMPOSITING')).toBe(4);
  });

  it('ignore la casse — un DCC écrit « anim » là où la production a saisi « ANIM »', () => {
    expect(departmentRank(PIPE, 'animation')).toBe(1);
  });

  it('rend -1 pour un département absent ou nul', () => {
    expect(departmentRank(PIPE, 'GRADING')).toBe(-1);
    expect(departmentRank(PIPE, null)).toBe(-1);
    expect(departmentRank(PIPE, undefined)).toBe(-1);
    expect(departmentRank(PIPE, '')).toBe(-1);
  });
});

describe('pickMostAdvanced', () => {
  it('préfère l’étape la plus en aval, même publiée avant', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'COMPOSITING', at: at('2026-01-01') },
        { id: 2, department: 'ANIMATION', at: at('2026-06-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(1);
  });

  it('départage deux versions de la même étape par la plus récente', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'FX', at: at('2026-01-01') },
        { id: 2, department: 'FX', at: at('2026-02-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(2);
  });

  it('départage par identifiant à date strictement égale', () => {
    const winner = pickMostAdvanced(
      [
        { id: 7, department: 'FX', at: at('2026-01-01') },
        { id: 9, department: 'FX', at: at('2026-01-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(9);
  });

  it('ne laisse jamais un département hors pipe devancer une étape connue', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'LAYOUT', at: at('2026-01-01') },
        { id: 2, department: 'GRADING', at: at('2026-06-01') },
        { id: 3, department: null, at: at('2026-07-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(1);
  });

  it('retombe sur le plus récent quand aucun candidat n’est dans le pipe', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: null, at: at('2026-01-01') },
        { id: 2, department: 'GRADING', at: at('2026-06-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(2);
  });

  it('rend null sans candidat', () => {
    expect(pickMostAdvanced([], PIPE)).toBeNull();
  });

  it('reste utilisable quand le projet n’a aucun département configuré', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'FX', at: at('2026-01-01') },
        { id: 2, department: 'LIGHTING', at: at('2026-02-01') },
      ],
      [],
    );
    expect(winner?.id).toBe(2);
  });
});

describe('groupByDepartment', () => {
  it('ordonne les groupes selon le pipe et rejette les inconnus à la fin', () => {
    const groups = groupByDepartment(
      [
        { department: 'COMPOSITING', n: 1 },
        { department: null, n: 2 },
        { department: 'LAYOUT', n: 3 },
        { department: 'GRADING', n: 4 },
      ],
      PIPE,
    );
    expect(groups.map((g) => g.key)).toEqual(['LAYOUT', 'COMPOSITING', null]);
    expect(groups[2]!.items.map((i) => i.n)).toEqual([2, 4]);
  });

  it('conserve le libellé du département et l’ordre d’arrivée dans un groupe', () => {
    const groups = groupByDepartment(
      [
        { department: 'fx', n: 1 },
        { department: 'FX', n: 2 },
      ],
      PIPE,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('FX');
    expect(groups[0]!.items.map((i) => i.n)).toEqual([1, 2]);
  });

  it('n’invente pas de groupe pour un département déclaré mais vide', () => {
    const groups = groupByDepartment([{ department: 'FX', n: 1 }], PIPE);
    expect(groups).toHaveLength(1);
  });
});
