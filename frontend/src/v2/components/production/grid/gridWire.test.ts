// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FAMILIES,
  FAMILY_LABEL,
  NO_FILTERS,
  NO_SEQUENCE,
  cellFamily,
  cellKind,
  familyTally,
  flattenGrid,
  gridSearch,
  groupBySequence,
  hasFilters,
  statusName,
  visibleDepartments,
  widestStatus,
  type GridCell,
  type GridCellStatus,
  type GridDepartment,
  type GridRow,
} from './gridWire';
import { t } from '../../../i18n';
import type { StatusFamily } from '../productionWire';

/**
 * Ce que la grille décide sans pixels.
 *
 * Trois décisions valent d'être verrouillées ici plutôt qu'à l'écran : la distinction
 * entre « à faire » et « pas au programme » (l'écran d'avant les confondait), l'agrégat
 * d'un groupe replié (qui remplace la matrice d'avancement) et la clé de cache, dont une
 * erreur ferait servir la page d'un filtre sous celle d'un autre.
 */

const department = (key: string, order: number): GridDepartment => ({
  id: order,
  key,
  name: key.toUpperCase(),
  color: null,
  order,
});

const DEPARTMENTS = [department('anim', 1), department('comp', 2), department('light', 3)];

/** Une case avec tâche, dans la famille demandée. */
const task = (key: string, family: StatusFamily): GridCell => ({
  departmentKey: key,
  taskId: 100 + key.length,
  status: { id: 1, code: 'IN_PROGRESS', name: 'In progress', color: null, family },
  assignee: null,
  versionCount: 0,
  lastActivityAt: null,
  dueDate: null,
  scheduled: true,
});

/** Une case au programme, sans tâche : du travail à faire. */
const idle = (key: string): GridCell => ({
  departmentKey: key,
  taskId: null,
  status: null,
  assignee: null,
  versionCount: 0,
  lastActivityAt: null,
  dueDate: null,
  scheduled: true,
});

/** Une case dont le département n'est pas au programme du plan. */
const offPlan = (key: string): GridCell => ({ ...idle(key), scheduled: false });

/** Une case à tâche portant exactement ce statut. */
const withStatus = (key: string, status: GridCellStatus): GridCell => ({ ...task(key, 'progress'), status });

/** Le statut d'un studio SANS référentiel : le serveur laisse `name` vide et met l'enum dans `code`. */
const legacy = (code: string, family: StatusFamily): GridCellStatus => ({
  id: null,
  code,
  name: '',
  color: null,
  family,
});

const row = (shotId: number, sequenceId: number | null, cells: GridCell[]): GridRow => ({
  shotId,
  code: `SH${shotId}`,
  name: `Shot ${shotId}`,
  sequenceId,
  sequenceCode: sequenceId === null ? null : `SQ${sequenceId}`,
  episodeId: null,
  episodeCode: null,
  status: null,
  cells,
});

describe('cellKind / cellFamily', () => {
  it('distingue une tâche, une case à faire et une case hors programme', () => {
    expect(cellKind(task('comp', 'progress'))).toBe('task');
    expect(cellKind(idle('comp'))).toBe('idle');
    expect(cellKind(offPlan('comp'))).toBe('unscheduled');
  });

  it('compte une case à faire comme « todo » et ne compte pas le hors-programme', () => {
    expect(cellFamily(idle('comp'))).toBe('todo');
    expect(cellFamily(offPlan('comp'))).toBeNull();
  });

  it('retient la famille du serveur quand la tâche existe', () => {
    expect(cellFamily(task('comp', 'blocked'))).toBe('blocked');
  });
});

describe('statusName', () => {
  it('écrit le NOM du référentiel, pas son code — « pending_review » n’est pas un mot', () => {
    const status: GridCellStatus = {
      id: 4,
      code: 'pending_review',
      name: 'To Review',
      color: '#F59E0B',
      family: 'review',
    };
    expect(statusName(status, t)).toBe('To Review');
  });

  it('traduit l’enum figé quand le studio n’a aucun référentiel', () => {
    expect(statusName(legacy('PENDING_REVIEW', 'review'), t)).toBe(t('task.status.toReview'));
    expect(statusName(legacy('IN_PROGRESS', 'progress'), t)).toBe(t('task.status.inProgress'));
  });

  it('retombe sur la famille pour un code que le catalogue ne connaît pas', () => {
    expect(statusName(legacy('ON_HOLD', 'blocked'), t)).toBe(t('kanban.family.blocked'));
  });

  it('ne rend jamais un identifiant à l’écran', () => {
    for (const status of [legacy('PENDING_REVIEW', 'review'), legacy('ON_HOLD', 'blocked')]) {
      expect(statusName(status, t)).not.toContain('_');
      expect(statusName(status, t)).not.toContain('.');
    }
  });

  it('nomme la case sans statut au lieu de la laisser muette', () => {
    expect(statusName(null, t)).toBe(t('production.grid.idle'));
  });
});

describe('widestStatus', () => {
  it('mesure le nom le plus long des cases à tâche', () => {
    const rows = [
      row(1, 10, [
        withStatus('anim', { id: 1, code: 'fin', name: 'Final', color: null, family: 'done' }),
        withStatus('comp', { id: 2, code: 'rev', name: 'Pending Review', color: null, family: 'review' }),
      ]),
    ];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe('Pending Review'.length);
  });

  it('ignore les cases sans tâche : elles n’écrivent rien', () => {
    const rows = [row(1, 10, [idle('anim'), offPlan('comp')])];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe(0);
  });

  it('ne compte que les colonnes visibles — une colonne masquée n’élargit plus la grille', () => {
    const rows = [
      row(1, 10, [
        withStatus('anim', { id: 1, code: 'fin', name: 'Final', color: null, family: 'done' }),
        withStatus('light', {
          id: 3,
          code: 'apr',
          name: 'Pending Client Approval',
          color: null,
          family: 'review',
        }),
      ]),
    ];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe('Pending Client Approval'.length);
    expect(widestStatus(rows, [DEPARTMENTS[0]], t)).toBe('Final'.length);
  });
});

describe('FAMILY_LABEL', () => {
  it('nomme les six familles — la légende ne peut pas en laisser une sans mot', () => {
    for (const family of FAMILIES) expect(FAMILY_LABEL[family]).toMatch(/^kanban\.family\./);
    expect(new Set(FAMILIES).size).toBe(6);
  });
});

describe('gridSearch', () => {
  it('ne porte que la limite quand aucun filtre n’est posé', () => {
    expect(gridSearch(NO_FILTERS, null)).toBe('?limit=50');
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('cumule les filtres et met le curseur en dernier', () => {
    const filters = { ...NO_FILTERS, sequenceId: 4, department: 'comp', status: 'IN_PROGRESS' };
    expect(hasFilters(filters)).toBe(true);
    expect(gridSearch(filters, null)).toBe('?limit=50&sequenceId=4&department=comp&status=IN_PROGRESS');
    // La clé de cache est exactement la même chaîne, curseur retiré.
    expect(gridSearch(filters, 'abc')).toBe(`${gridSearch(filters, null)}&cursor=abc`);
  });

  it('sépare deux filtres différents — sans quoi une page serait servie sous la clé de l’autre', () => {
    expect(gridSearch({ ...NO_FILTERS, assigneeId: 1 }, null)).not.toBe(
      gridSearch({ ...NO_FILTERS, assigneeId: 2 }, null),
    );
  });
});

describe('groupBySequence', () => {
  it('rassemble les plans d’une même sequence même s’ils ne se suivent pas', () => {
    const rows = [row(1, 10, []), row(2, 11, []), row(3, 10, [])];
    const groups = groupBySequence(rows);
    expect(groups.map((g) => g.key)).toEqual(['10', '11']);
    expect(groups[0].rows.map((r) => r.shotId)).toEqual([1, 3]);
  });

  it('range les plans sans sequence dans un groupe à part', () => {
    const groups = groupBySequence([row(1, null, [])]);
    expect(groups[0].key).toBe(NO_SEQUENCE);
    expect(groups[0].sequenceCode).toBeNull();
  });
});

describe('familyTally', () => {
  it('agrège les familles et écarte le hors-programme du dénominateur', () => {
    const rows = [
      row(1, 10, [task('anim', 'done'), task('comp', 'progress'), offPlan('light')]),
      row(2, 10, [task('anim', 'done'), idle('comp'), offPlan('light')]),
    ];
    const tally = familyTally(rows);
    expect(tally.total).toBe(4);
    expect(tally.done).toBe(2);
    expect(tally.counts.progress).toBe(1);
    expect(tally.counts.todo).toBe(1);
  });

  it('rend un total nul quand tout est hors programme', () => {
    expect(familyTally([row(1, 10, [offPlan('anim')])]).total).toBe(0);
  });
});

describe('visibleDepartments', () => {
  const rows = [row(1, 10, [task('anim', 'done'), idle('comp'), offPlan('light')])];

  it('garde toutes les colonnes par défaut', () => {
    expect(visibleDepartments(DEPARTMENTS, rows, false)).toHaveLength(3);
  });

  it('retire la colonne qu’aucun plan n’a au programme', () => {
    expect(visibleDepartments(DEPARTMENTS, rows, true).map((d) => d.key)).toEqual(['anim', 'comp']);
  });
});

describe('flattenGrid', () => {
  const groups = groupBySequence([row(1, 10, []), row(2, 10, []), row(3, 11, [])]);

  it('monte l’en-tête de groupe puis ses plans', () => {
    expect(flattenGrid(groups, new Set()).map((l) => l.key)).toEqual([
      'group:10',
      'shot:1',
      'shot:2',
      'group:11',
      'shot:3',
    ]);
  });

  it('garde l’en-tête d’un groupe replié et laisse tomber ses plans', () => {
    expect(flattenGrid(groups, new Set(['10'])).map((l) => l.key)).toEqual([
      'group:10',
      'group:11',
      'shot:3',
    ]);
  });
});
