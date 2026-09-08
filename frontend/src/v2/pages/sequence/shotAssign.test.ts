// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { attachRefusal, attachableShots, movedFromOtherSequence, type AttachableShot } from './shotAssign';

const shot = (id: number, code: string, sequenceId: number | null, name = code): AttachableShot => ({
  id,
  code,
  name,
  sequenceId,
});

/** Un projet ordinaire : deux plans dans la séquence ouverte, deux ailleurs, deux libres. */
const PROJECT: AttachableShot[] = [
  shot(1, 'SH010', 7),
  shot(2, 'SH020', 7),
  shot(3, 'SH100', 8),
  shot(4, 'SH110', 8),
  shot(5, 'SH200', null),
  shot(6, 'SH210', null, 'Wide establishing'),
];

describe('attachableShots', () => {
  it('écarte les plans déjà dans la séquence', () => {
    const { free, elsewhere } = attachableShots(PROJECT, 7);
    const proposed = [...free, ...elsewhere].map((s) => s.id);
    expect(proposed).not.toContain(1);
    expect(proposed).not.toContain(2);
    expect(proposed).toHaveLength(4);
  });

  it('sépare les plans libres de ceux pris à une autre séquence', () => {
    const { free, elsewhere } = attachableShots(PROJECT, 7);
    expect(free.map((s) => s.code)).toEqual(['SH200', 'SH210']);
    expect(elsewhere.map((s) => s.code)).toEqual(['SH100', 'SH110']);
  });

  it('trie les codes numériquement, pas alphabétiquement', () => {
    const messy = [shot(1, 'SH100', null), shot(2, 'SH20', null), shot(3, 'SH3', null)];
    expect(attachableShots(messy, 7).free.map((s) => s.code)).toEqual(['SH3', 'SH20', 'SH100']);
  });

  it('filtre sur le code et sur le nom, sans tenir compte de la casse', () => {
    expect(attachableShots(PROJECT, 7, 'sh1').elsewhere.map((s) => s.id)).toEqual([3, 4]);
    expect(attachableShots(PROJECT, 7, 'ESTABLISHING').free.map((s) => s.id)).toEqual([6]);
    expect(attachableShots(PROJECT, 7, '  sh210  ').free.map((s) => s.id)).toEqual([6]);
  });

  it('ne propose rien quand tout le projet est déjà dans la séquence', () => {
    const all = [shot(1, 'SH010', 7), shot(2, 'SH020', 7)];
    expect(attachableShots(all, 7)).toEqual({ free: [], elsewhere: [] });
  });
});

describe('movedFromOtherSequence', () => {
  it('ne compte que les plans retenus qui quittent une séquence', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([3, 5, 6]))).toBe(1);
  });

  it('vaut zéro quand la sélection n’est faite que de plans libres', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([5, 6]))).toBe(0);
  });

  it('ignore les identifiants qui ne sont pas dans la liste', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([999]))).toBe(0);
  });
});

describe('attachRefusal', () => {
  it('refuse un non-gestionnaire, sélection remplie ou non', () => {
    expect(attachRefusal(false, 3)).toBe('forbidden');
    expect(attachRefusal(false, 0)).toBe('forbidden');
  });

  it('refuse une sélection vide', () => {
    expect(attachRefusal(true, 0)).toBe('empty');
  });

  it('laisse passer un gestionnaire qui a choisi', () => {
    expect(attachRefusal(true, 1)).toBeNull();
  });
});
