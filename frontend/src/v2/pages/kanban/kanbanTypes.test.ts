// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { initialsFrom, removeView, upsertView, type KanbanViewsPref } from './kanbanTypes';

const f = (assignee = '', type = '', sequence = '') => ({ assignee, type, sequence });

describe('vues kanban sauvegardées — upsertView / removeView', () => {
  it('ajoute une vue à un projet vide', () => {
    const next = upsertView({}, 5, { name: 'Mes anims', filter: f('3', 'ANIM') });
    expect(next).toEqual({ '5': [{ name: 'Mes anims', filter: f('3', 'ANIM') }] });
  });

  it('remplace une vue du même nom sans toucher les autres projets', () => {
    const views: KanbanViewsPref = {
      '5': [{ name: 'A', filter: f('1') }],
      '9': [{ name: 'A', filter: f('2') }],
    };
    const next = upsertView(views, 5, { name: 'A', filter: f('7') });
    expect(next['5']).toEqual([{ name: 'A', filter: f('7') }]);
    expect(next['9']).toEqual(views['9']);
    // pureté : l'original n'est pas muté
    expect(views['5'][0].filter.assignee).toBe('1');
  });

  it('retire une vue et supprime la clé projet quand vide', () => {
    const views: KanbanViewsPref = {
      '5': [
        { name: 'A', filter: f() },
        { name: 'B', filter: f() },
      ],
    };
    expect(removeView(views, 5, 'A')['5']).toEqual([{ name: 'B', filter: f() }]);
    expect(removeView(removeView(views, 5, 'A'), 5, 'B')).toEqual({});
  });

  it('ignore un retrait inconnu', () => {
    const views: KanbanViewsPref = { '5': [{ name: 'A', filter: f() }] };
    expect(removeView(views, 5, 'Z')).toEqual(views);
    expect(removeView(views, 8, 'A')).toEqual(views);
  });
});

describe('initialsFrom', () => {
  it('extrait les initiales', () => {
    expect(initialsFrom('Ada Lovelace')).toBe('AL');
    expect(initialsFrom('ada')).toBe('A');
    expect(initialsFrom(null)).toBe('?');
  });
});
