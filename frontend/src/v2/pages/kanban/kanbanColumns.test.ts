// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildColumns, columnIdOf, familyOf, groupByFamily, type ColumnStatus } from './kanbanColumns';
import type { MessageKey } from '../../i18n';

const t = (key: MessageKey) => key;

const status = (over: Partial<ColumnStatus> & { id: number }): ColumnStatus => ({
  name: `S${over.id}`,
  code: `s${over.id}`,
  color: null,
  legacyStatus: 'TODO',
  ...over,
});

describe('familyOf', () => {
  it('range chaque valeur de l’énumération dans sa famille', () => {
    expect(familyOf('TODO')).toBe('todo');
    expect(familyOf('IN_PROGRESS')).toBe('progress');
    expect(familyOf('PENDING_REVIEW')).toBe('review');
    expect(familyOf('APPROVED')).toBe('done');
    expect(familyOf('RETAKE')).toBe('blocked');
    expect(familyOf('REJECTED')).toBe('blocked');
  });

  it('range un statut sans équivalent dans « à faire » plutôt que nulle part', () => {
    expect(familyOf(null)).toBe('todo');
  });
});

describe('buildColumns', () => {
  it('retombe sur les six valeurs figées quand le projet n’a pas de référentiel', () => {
    const columns = buildColumns([], t);
    expect(columns).toHaveLength(6);
    expect(columns.every((c) => c.statusId === null)).toBe(true);
    expect(columns[0].id).toBe('TODO');
  });

  it('bâtit les colonnes sur le vocabulaire du projet', () => {
    const columns = buildColumns(
      [
        status({ id: 10, name: 'Waiting to Start', legacyStatus: 'TODO' }),
        status({ id: 11, name: 'On Hold', legacyStatus: 'TODO' }),
        status({ id: 12, name: 'Supervisor Approved', legacyStatus: 'APPROVED' }),
      ],
      t,
    );
    expect(columns.map((c) => c.label)).toEqual(['Waiting to Start', 'On Hold', 'Supervisor Approved']);
    expect(columns.map((c) => c.id)).toEqual(['10', '11', '12']);
  });

  it('ordonne par famille sans mélanger l’ordre du référentiel', () => {
    const columns = buildColumns(
      [
        status({ id: 1, legacyStatus: 'APPROVED' }),
        status({ id: 2, legacyStatus: 'TODO' }),
        status({ id: 3, legacyStatus: 'APPROVED' }),
        status({ id: 4, legacyStatus: 'IN_PROGRESS' }),
      ],
      t,
    );
    // à faire → en cours → terminé, et « 1 avant 3 » à l'intérieur de « terminé ».
    expect(columns.map((c) => c.id)).toEqual(['2', '4', '1', '3']);
  });
});

describe('groupByFamily', () => {
  const columns = buildColumns(
    [
      status({ id: 1, legacyStatus: 'TODO' }),
      status({ id: 2, legacyStatus: 'IN_PROGRESS' }),
      status({ id: 3, legacyStatus: 'IN_PROGRESS' }),
    ],
    t,
  );

  it('ne rend que les familles qui ont une colonne', () => {
    expect(groupByFamily(columns, new Set()).map((g) => g.key)).toEqual(['todo', 'progress']);
  });

  it('retire les colonnes masquées, et la famille avec quand elle se vide', () => {
    expect(groupByFamily(columns, new Set(['1'])).map((g) => g.key)).toEqual(['progress']);
    expect(groupByFamily(columns, new Set(['2'])).flatMap((g) => g.columns.map((c) => c.id))).toEqual([
      '1',
      '3',
    ]);
  });
});

describe('columnIdOf', () => {
  const columns = buildColumns(
    [
      status({ id: 10, legacyStatus: 'TODO' }),
      status({ id: 11, legacyStatus: 'TODO' }),
      status({ id: 12, legacyStatus: 'APPROVED' }),
    ],
    t,
  );

  it('range la tâche dans la colonne de son statut', () => {
    expect(columnIdOf({ pipelineStatusId: 11, status: 'TODO' }, columns)).toBe('11');
  });

  it('retombe sur l’énumération quand le statut n’est pas offert au projet', () => {
    // Une tâche importée porte l'identifiant d'un statut du site d'un autre projet : sans
    // ce repli, elle disparaîtrait purement et simplement du board.
    expect(columnIdOf({ pipelineStatusId: 999, status: 'APPROVED' }, columns)).toBe('12');
  });

  it('rend null quand aucune colonne ne peut l’accueillir', () => {
    expect(columnIdOf({ pipelineStatusId: null, status: 'RETAKE' }, columns)).toBeNull();
  });
});
