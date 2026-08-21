// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  activeCount,
  applyFilters,
  fromRecord,
  matches,
  toRecord,
  type EntityFilterState,
  type Filterable,
} from './entityFilters';

const filters = (over: Partial<EntityFilterState> = {}): EntityFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});
const item = (over: Partial<Filterable> = {}): Filterable => ({ text: 'SH010 comp', ...over });

describe('activeCount', () => {
  it('ne compte que les critères posés', () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
    expect(activeCount(filters({ text: 'sh', assignee: 'none' }))).toBe(2);
  });
});

describe('toRecord / fromRecord', () => {
  it('omet les critères vides à l’enregistrement', () => {
    expect(toRecord(filters({ status: '4' }))).toEqual({ status: '4' });
  });

  it('relit une vue en ignorant ce qu’elle ne connaît pas', () => {
    expect(fromRecord({ status: '4', inconnu: 'x' })).toEqual(filters({ status: '4' }));
  });

  it('fait l’aller-retour sans rien perdre', () => {
    const f = filters({ text: 'roof', assignee: '7', sequence: 'none' });
    expect(fromRecord(toRecord(f))).toEqual(f);
  });
});

describe('matches', () => {
  it('laisse tout passer sans critère', () => {
    expect(matches(EMPTY_FILTERS, item())).toBe(true);
  });

  it('cherche le texte sans tenir compte de la casse ni des espaces autour', () => {
    expect(matches(filters({ text: '  COMP ' }), item())).toBe(true);
    expect(matches(filters({ text: 'anim' }), item())).toBe(false);
  });

  it('distingue « tout », « sans » et une valeur précise', () => {
    expect(matches(filters({ assignee: '' }), item({ assigneeId: null }))).toBe(true);
    expect(matches(filters({ assignee: 'none' }), item({ assigneeId: null }))).toBe(true);
    expect(matches(filters({ assignee: 'none' }), item({ assigneeId: 7 }))).toBe(false);
    expect(matches(filters({ assignee: '7' }), item({ assigneeId: 7 }))).toBe(true);
    expect(matches(filters({ assignee: '7' }), item({ assigneeId: 8 }))).toBe(false);
  });

  it('filtre hors séquence et sans département de la même façon', () => {
    expect(matches(filters({ sequence: 'none' }), item({ sequenceId: null }))).toBe(true);
    expect(matches(filters({ department: 'none' }), item({ departmentId: 3 }))).toBe(false);
  });

  it('reconnaît une entité qui traverse plusieurs départements', () => {
    // Un plan ou un asset n'appartient pas à *un* département : il en traverse plusieurs.
    // Comparer à un identifiant unique ne correspondait jamais, et l'écran vidait la
    // liste dès qu'on choisissait un département.
    expect(matches(filters({ department: '3' }), item({ departmentIds: [1, 3] }))).toBe(true);
    expect(matches(filters({ department: '4' }), item({ departmentIds: [1, 3] }))).toBe(false);
    // « Sans département » ne peut pas désigner une entité qui en traverse.
    expect(matches(filters({ department: 'none' }), item({ departmentIds: [1] }))).toBe(false);
    // Liste vide : on retombe sur le champ unique, pour les entités qui n'en portent pas.
    expect(matches(filters({ department: '3' }), item({ departmentIds: [], departmentId: 3 }))).toBe(true);
  });

  it('compare le statut au référentiel du projet en priorité', () => {
    expect(matches(filters({ status: '12' }), item({ statusId: 12 }))).toBe(true);
    expect(matches(filters({ status: '12' }), item({ statusId: 13 }))).toBe(false);
  });

  it('retombe sur l’énumération pour une entité sans statut personnalisé', () => {
    // Une tâche ancienne ne porte que « IN_PROGRESS » : sans ce repli, elle disparaîtrait
    // dès qu'un filtre de statut est posé.
    expect(matches(filters({ status: 'IN_PROGRESS' }), item({ legacyStatus: 'IN_PROGRESS' }))).toBe(true);
    expect(matches(filters({ status: 'TODO' }), item({ legacyStatus: 'IN_PROGRESS' }))).toBe(false);
  });

  it('ne confond pas « sans statut » avec un statut posé', () => {
    expect(matches(filters({ status: 'none' }), item({ statusId: null }))).toBe(true);
    expect(matches(filters({ status: 'none' }), item({ statusId: 4 }))).toBe(false);
  });

  it('exige que tous les critères passent ensemble', () => {
    const f = filters({ text: 'sh010', assignee: '7' });
    expect(matches(f, item({ assigneeId: 7 }))).toBe(true);
    expect(matches(f, item({ assigneeId: 8 }))).toBe(false);
  });
});

describe('applyFilters', () => {
  const rows = [
    { id: 1, code: 'SH010', assigneeId: 7 },
    { id: 2, code: 'SH020', assigneeId: null },
  ];
  const toFilterable = (r: (typeof rows)[number]): Filterable => ({
    text: r.code,
    assigneeId: r.assigneeId,
  });

  it('rend la liste telle quelle quand rien n’est filtré — même référence', () => {
    expect(applyFilters(EMPTY_FILTERS, rows, toFilterable)).toBe(rows);
  });

  it('filtre sur les critères posés', () => {
    expect(applyFilters(filters({ assignee: 'none' }), rows, toFilterable).map((r) => r.id)).toEqual([2]);
  });
});
