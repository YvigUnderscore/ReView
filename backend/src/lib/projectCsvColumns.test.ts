// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectColumns, indexByField, normaliseHeader } from './projectCsvColumns';

const fields = (headers: string[], overrides?: Parameters<typeof detectColumns>[1]) =>
  detectColumns(headers, overrides).map((c) => c.field);

describe('normaliseHeader', () => {
  it('ignore casse, accents, séparateurs et BOM', () => {
    expect(normaliseHeader('﻿Échéance')).toBe('echeance');
    expect(normaliseHeader('Cut In')).toBe('cutin');
    expect(normaliseHeader('sg_status_list')).toBe('sgstatuslist');
  });
});

describe('detectColumns', () => {
  it('reconnaît les en-têtes des trackers usuels', () => {
    expect(fields(['sg_sequence', 'Shot Code', 'Shot Name', 'sg_cut_in', 'sg_cut_out'])).toEqual([
      'sequence',
      'shot',
      'name',
      'startFrame',
      'endFrame',
    ]);
    expect(fields(['Episode', 'Plan', 'Tâches', 'Responsable', 'Échéance'])).toEqual([
      'episode',
      'shot',
      'task',
      'assignee',
      'dueDate',
    ]);
  });

  it('un « status » nu vise la tâche quand le fichier a une colonne de tâche', () => {
    expect(fields(['shot', 'task', 'status'])).toEqual(['shot', 'task', 'taskStatus']);
  });

  it('un « status » nu vise le plan quand le fichier n’a pas de tâche', () => {
    expect(fields(['shot', 'status'])).toEqual(['shot', 'shotStatus']);
  });

  it('n’écrase pas une colonne de statut déjà explicite', () => {
    expect(fields(['shot', 'task', 'task_status', 'status'])).toEqual([
      'shot',
      'task',
      'taskStatus',
      'shotStatus',
    ]);
  });

  it('laisse la colonne inconnue sans champ plutôt que de deviner', () => {
    expect(fields(['shot', 'sg_uploaded_movie'])).toEqual(['shot', null]);
  });

  it('la correspondance manuelle prime sur l’en-tête et sait neutraliser une colonne', () => {
    const columns = detectColumns(
      ['identifiant', 'libelle', 'description'],
      [
        { index: 0, field: 'shot' },
        { index: 1, field: 'name' },
        { index: 2, field: null },
      ],
    );
    expect(columns.map((c) => c.field)).toEqual(['shot', 'name', null]);
    expect(columns.map((c) => c.manual)).toEqual([true, true, true]);
  });

  it('deux colonnes ne peuvent pas viser le même champ : la seconde est ignorée', () => {
    expect(fields(['shot', 'shot_code'])).toEqual(['shot', null]);
  });

  it('indexByField rend la position de chaque champ reconnu', () => {
    expect(indexByField(detectColumns(['seq', 'shot', 'inconnu', 'tasks']))).toEqual({
      sequence: 0,
      shot: 1,
      task: 3,
    });
  });
});
