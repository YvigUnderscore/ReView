// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TASK_STATUS_LABEL_KEY } from '../../../lib/taskStatus';
import type { MessageKey, Tr } from '../../../i18n';
import type { StatusFamily } from '../productionWire';

/**
 * Le contrat de la grille de suivi, et les décisions qu'elle prend sans DOM.
 *
 * L'écran « Where the project stands » croisait des séquences et des départements, et
 * l'utilisateur l'a jugé incompréhensible : une case y valait une moyenne, aucune ne
 * disait quel plan attendait quoi, les colonnes étaient des clés techniques triées par
 * ordre alphabétique et les cinq couleurs n'étaient nommées que dans un attribut `title`.
 *
 * La grille le remplace à la maille du PLAN. Tout ce qui se décide sans pixels vit ici —
 * regroupement, agrégat replié, colonnes visibles, nature d'une case — pour être vérifié
 * sans navigateur. Les types miroitent `backend/src/services/GridService.ts` : quand ils
 * divergeront, c'est le service qui aura raison.
 */

/** Un département du référentiel, dans l'ordre du pipe. */
export interface GridDepartment {
  id: number;
  key: string;
  name: string;
  /** Teinte réglée par le studio (#RRGGBB) — posée en style, jamais en classe. */
  color: string | null;
  order: number;
}

/** Le statut PROPRE du plan — il existe en base et n'était affiché nulle part. */
export interface GridShotStatus {
  id: number;
  code: string;
  name: string;
  color: string | null;
}

/**
 * Le statut d'une case. `name` vide signifie « le studio n'a pas de référentiel » : c'est
 * alors à l'écran de traduire `code`, qui porte la valeur de l'enum figé.
 */
export interface GridCellStatus {
  id: number | null;
  code: string;
  name: string;
  color: string | null;
  family: StatusFamily;
}

export interface GridCell {
  departmentKey: string;
  taskId: number | null;
  status: GridCellStatus | null;
  assignee: { id: number; name: string | null } | null;
  versionCount: number;
  lastActivityAt: string | null;
  dueDate: string | null;
  /** Ce département est-il au programme de ce plan ? */
  scheduled: boolean;
}

export interface GridRow {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  episodeId: number | null;
  episodeCode: string | null;
  status: GridShotStatus | null;
  cells: GridCell[];
}

export interface ProjectGrid {
  departments: GridDepartment[];
  rows: GridRow[];
  nextCursor: string | null;
  total: number;
}

// -- Familles de statut : nommées à l'écran, pas seulement colorées ------------

/**
 * L'ordre de la légende et des barres empilées : ce qui est fait d'abord, ce qui n'a pas
 * commencé ensuite. Une barre qui rangerait `todo` en tête ferait reculer l'avancement.
 */
export const FAMILIES: StatusFamily[] = ['done', 'review', 'progress', 'blocked', 'todo', 'inactive'];

/** Le nom de chaque famille. Les clés existent déjà — le kanban les affiche en colonnes. */
export const FAMILY_LABEL: Record<StatusFamily, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
  inactive: 'kanban.family.inactive',
};

// -- Nom d'un statut ----------------------------------------------------------

/** Libellés de l'enum figé, indexables — un code inconnu retombe sur sa famille. */
const LEGACY_LABEL: Record<string, MessageKey | undefined> = TASK_STATUS_LABEL_KEY;

/**
 * Le nom du statut, tel qu'une case l'ÉCRIT.
 *
 * C'est le **nom** et non le `code` : le code n'est court que dans un référentiel ShotGrid
 * (`ip`, `fin`, `rev`) ; le vocabulaire local, celui que toute instance reçoit à la
 * migration, porte des codes `in_progress`, `pending_review` — plus longs et moins
 * lisibles que les noms « In Progress » et « To Review » que le studio a écrits pour être
 * lus. Le nom est donc la bonne réponse dans la case, et le code ne sert à rien à l'écran.
 *
 * Sans référentiel du tout, le serveur laisse `name` vide et met la valeur de l'enum figé
 * dans `code` : c'est un identifiant, jamais un mot, et on rend son libellé traduit.
 */
export function statusName(status: GridCellStatus | null, t: Tr): string {
  if (!status) return t('production.grid.idle');
  if (status.name.trim() !== '') return status.name;
  return t(LEGACY_LABEL[status.code] ?? FAMILY_LABEL[status.family]);
}

/**
 * Longueur, en caractères, du nom le plus long qu'une case de la page va écrire.
 *
 * C'est ce qui règle la largeur des colonnes : une passe sur les DONNÉES, une seule fois
 * par rendu — pas une mesure de texte par case, qui ferait douze cents lectures de mise
 * en page à chaque cran de défilement.
 *
 * Seules les colonnes visibles comptent : sous « masquer les colonnes vides », le nom
 * interminable d'un département retiré n'a plus à élargir la grille de tout le monde.
 */
export function widestStatus(rows: GridRow[], columns: GridDepartment[], t: Tr): number {
  const shown = new Set(columns.map((department) => department.key));
  let longest = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      // Une case sans tâche n'écrit rien : elle garde son anneau ou son tiret.
      if (cell.taskId === null || !shown.has(cell.departmentKey)) continue;
      longest = Math.max(longest, statusName(cell.status, t).length);
    }
  }
  return longest;
}

// -- Filtres ------------------------------------------------------------------

/** Plans demandés par page. La route plafonne à 200 ; 50 tient l'écran sans le saturer. */
export const GRID_PAGE = 50;

export interface GridFilters {
  episodeId: number | null;
  sequenceId: number | null;
  /** CLÉ du département (`comp`), jamais son libellé. */
  department: string | null;
  assigneeId: number | null;
  /** Code de statut du studio, ou valeur de l'enum figé à défaut de référentiel. */
  status: string | null;
}

export const NO_FILTERS: GridFilters = {
  episodeId: null,
  sequenceId: null,
  department: null,
  assigneeId: null,
  status: null,
};

export const hasFilters = (filters: GridFilters): boolean =>
  Object.values(filters).some((value) => value !== null);

/**
 * La query-string de la route — et, sans curseur, la clé de cache.
 *
 * Une seule fonction pour les deux : deux écritures finiraient par diverger, et une page
 * servie sous la clé d'un autre filtre est une grille qui montre les plans du voisin.
 */
export function gridSearch(filters: GridFilters, cursor: string | null, limit = GRID_PAGE): string {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (filters.episodeId !== null) params.set('episodeId', String(filters.episodeId));
  if (filters.sequenceId !== null) params.set('sequenceId', String(filters.sequenceId));
  if (filters.department !== null) params.set('department', filters.department);
  if (filters.assigneeId !== null) params.set('assigneeId', String(filters.assigneeId));
  if (filters.status !== null) params.set('status', filters.status);
  // Le curseur en dernier : la clé de cache est exactement la même chaîne sans lui.
  if (cursor !== null) params.set('cursor', cursor);
  return `?${params.toString()}`;
}

// -- Nature d'une case --------------------------------------------------------

/**
 * Trois cases, trois sens — et c'est la distinction qui manquait le plus.
 *
 * `unscheduled` : le département n'est pas au programme du plan, il n'y a rien à y
 * attendre. `idle` : il est au programme, personne n'a encore créé la tâche — c'est du
 * travail à faire. Les confondre faisait lire « rien à signaler » là où il n'y avait
 * aucun engagement, et inversement.
 */
export type CellKind = 'unscheduled' | 'idle' | 'task';

export function cellKind(cell: GridCell): CellKind {
  if (cell.taskId !== null) return 'task';
  return cell.scheduled ? 'idle' : 'unscheduled';
}

/** La famille d'une case, `idle` comprise : une case à faire est une case `todo`. */
export function cellFamily(cell: GridCell): StatusFamily | null {
  const kind = cellKind(cell);
  if (kind === 'unscheduled') return null;
  return cell.status?.family ?? 'todo';
}

// -- Regroupement par sequence ------------------------------------------------

/** Clé du groupe des plans qu'aucune sequence ne réclame. */
export const NO_SEQUENCE = 'none';

export interface SequenceGroup {
  key: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  episodeCode: string | null;
  rows: GridRow[];
}

/**
 * Les plans rangés par sequence, dans l'ordre où le serveur les sert.
 *
 * Un index plutôt qu'un découpage en tranches : rien ne garantit que deux plans d'une même
 * sequence se suivent (`Shot.order` est libre), et un découpage naïf ouvrirait deux
 * groupes portant le même nom.
 */
export function groupBySequence(rows: GridRow[]): SequenceGroup[] {
  const groups = new Map<string, SequenceGroup>();
  for (const row of rows) {
    const key = row.sequenceId === null ? NO_SEQUENCE : String(row.sequenceId);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sequenceId: row.sequenceId,
        sequenceCode: row.sequenceCode,
        episodeCode: row.episodeCode,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

// -- Agrégat d'un groupe replié ----------------------------------------------

export interface FamilyTally {
  /** Cases comptées : le hors-programme n'en fait pas partie. */
  total: number;
  done: number;
  counts: Record<StatusFamily, number>;
}

const zeroCounts = (): Record<StatusFamily, number> => ({
  todo: 0,
  progress: 0,
  review: 0,
  done: 0,
  blocked: 0,
  inactive: 0,
});

/**
 * L'agrégat que porte une sequence repliée : c'est ainsi que la maille séquence survit à
 * la disparition de la matrice d'avancement — elle devient l'état replié de la grille.
 *
 * Les cases hors programme sont écartées du dénominateur : un plan qui ne passe pas par
 * le compositing ne doit pas faire baisser l'avancement de sa sequence.
 */
export function familyTally(rows: GridRow[]): FamilyTally {
  const counts = zeroCounts();
  let total = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      const family = cellFamily(cell);
      if (family === null) continue;
      counts[family] += 1;
      total += 1;
    }
  }
  return { total, done: counts.done, counts };
}

// -- Colonnes visibles --------------------------------------------------------

/**
 * Les colonnes à montrer. En mode « masquer les colonnes vides », un département ne
 * survit que si au moins un plan de la page l'a au programme ou y porte une tâche : une
 * colonne où personne n'a rien à faire ne mérite pas la largeur qu'elle prend.
 */
export function visibleDepartments(
  departments: GridDepartment[],
  rows: GridRow[],
  hideEmpty: boolean,
): GridDepartment[] {
  if (!hideEmpty) return departments;
  const used = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cellKind(cell) !== 'unscheduled') used.add(cell.departmentKey);
    }
  }
  return departments.filter((department) => used.has(department.key));
}

// -- Lignes à monter ----------------------------------------------------------

export type GridLine =
  { kind: 'group'; key: string; group: SequenceGroup } | { kind: 'row'; key: string; row: GridRow };

/**
 * La liste plate que le virtualiseur indexe. Un groupe replié garde sa ligne d'en-tête —
 * c'est elle qui porte l'agrégat — et laisse tomber ses plans.
 */
export function flattenGrid(groups: SequenceGroup[], collapsed: ReadonlySet<string>): GridLine[] {
  const lines: GridLine[] = [];
  for (const group of groups) {
    lines.push({ kind: 'group', key: `group:${group.key}`, group });
    if (collapsed.has(group.key)) continue;
    for (const row of group.rows) lines.push({ kind: 'row', key: `shot:${row.shotId}`, row });
  }
  return lines;
}
