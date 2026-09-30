// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { detectDelimiter, splitCsvLine } from './projectCsv';
import {
  detectColumns,
  indexByField,
  type ColumnOverride,
  type CsvField,
  type DetectedColumn,
} from './projectCsvColumns';

/**
 * Lecture enrichie d'un CSV de pipeline : épisode, séquence, plan, fiche, plage de frames,
 * tâches, département, statut, assignation et dates.
 *
 * Deux partis pris tirés de la forme réelle des exports de tracker :
 *
 * 1. **Une ligne par tâche est la norme.** ShotGrid, ftrack et Kitsu exportent le plan
 *    autant de fois qu'il a de tâches. Les lignes qui désignent le même plan sont donc
 *    FUSIONNÉES, jamais rejetées comme doublons — c'est le rejet qui était le défaut.
 * 2. **Aucun message en clair.** Chaque anomalie est un code (`CsvIssueCode`) accompagné
 *    de la ligne, de la colonne et de la valeur fautive : c'est l'interface qui la rédige,
 *    dans la langue du lecteur, et le rapport téléchargeable en découle.
 *
 * Module PUR : aucune dépendance Prisma, entièrement testable.
 */

export type CsvIssueCode =
  | 'EMPTY_FILE'
  | 'MISSING_SHOT_COLUMN'
  | 'UNKNOWN_COLUMN'
  | 'MISSING_SHOT'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'FRAME_RANGE_MISMATCH'
  | 'CONFLICTING_VALUE'
  | 'TRUNCATED_VALUE'
  | 'DUPLICATE_TASK'
  | 'TOO_MANY_ROWS'
  | 'EPISODES_DISABLED'
  | 'TAGS_UNSUPPORTED'
  | 'IN_TRASH'
  | 'UNKNOWN_STATUS'
  | 'UNKNOWN_DEPARTMENT'
  | 'UNKNOWN_ASSIGNEE';

/** Une anomalie localisée. `line` est le numéro de ligne du fichier (1 = en-tête). */
export interface CsvIssue {
  code: CsvIssueCode;
  line: number | null;
  /** En-tête de la colonne fautive, tel qu'écrit dans le fichier. */
  column?: string;
  /** Valeur refusée, tronquée à 80 caractères pour ne pas gonfler la réponse. */
  value?: string;
  /** Code du plan concerné, pour retrouver la ligne dans un tableur trié. */
  shot?: string;
}

export interface ParsedTaskRow {
  line: number;
  name: string;
  department: string | null;
  status: string | null;
  assignee: string | null;
  /** Date au format ISO `YYYY-MM-DD`, déjà validée. */
  startDate: string | null;
  dueDate: string | null;
}

/** Un plan et tout ce que le fichier en dit, une fois ses lignes fusionnées. */
export interface ParsedEntry {
  /** Première ligne du fichier qui décrit ce plan. */
  line: number;
  lines: number[];
  episode: string | null;
  sequence: string | null;
  shot: string;
  name: string | null;
  description: string | null;
  tags: string[];
  status: string | null;
  startFrame: number | null;
  endFrame: number | null;
  frames: number | null;
  tasks: ParsedTaskRow[];
  issues: CsvIssue[];
}

export interface ProjectCsvParse {
  columns: DetectedColumn[];
  entries: ParsedEntry[];
  /** Anomalies de fichier et lignes rejetées (celles qui ne produisent aucun plan). */
  issues: CsvIssue[];
  /** Nombre de lignes de données lues, en-tête exclu. */
  dataLines: number;
}

/** Au-delà, on refuse de lire : un fichier de cette taille n'est plus une migration. */
const MAX_DATA_LINES = 20_000;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 4000;

const clip = (v: string) => (v.length > 80 ? `${v.slice(0, 80)}…` : v);

/**
 * Entier positif ou nul lu dans une cellule. `1 001` et `1,001` viennent des tableurs :
 * les espaces (y compris insécables) et les séparateurs de milliers sont retirés.
 */
export function parseCsvInteger(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}

/**
 * Date d'une cellule, ramenée en ISO `YYYY-MM-DD`.
 *
 * Quatre écritures acceptées : `YYYY-MM-DD` (et `YYYY/MM/DD`), puis `DD/MM/YYYY`,
 * `DD-MM-YYYY` et `DD.MM.YYYY`. Le jour d'abord, pas le mois : `03/04/2026` est le
 * 3 avril partout sauf aux États-Unis, et deviner au cas par cas déplacerait
 * silencieusement des échéances. Le format américain se convertit avant l'import — la
 * documentation le dit.
 */
export function parseCsvDate(raw: string): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  const euro = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  const parts = iso
    ? { y: iso[1], m: iso[2], d: iso[3] }
    : euro
      ? { y: euro[3], m: euro[2], d: euro[1] }
      : null;
  if (!parts) return null;
  const y = Number(parts.y);
  const m = Number(parts.m);
  const d = Number(parts.d);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Valeurs multiples d'une cellule (`Anim|Comp`) — la barre verticale, jamais le délimiteur. */
function multi(raw: string): string[] {
  return raw
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Clé de fusion d'un plan : la séquence et le code, insensibles à la casse. */
const entryKey = (sequence: string | null, shot: string) =>
  `${(sequence ?? '').toLowerCase()}::${shot.toLowerCase()}`;

/**
 * Lit le fichier. `overrides` impose la correspondance de colonnes décidée par
 * l'utilisateur quand l'en-tête ne suffit pas.
 */
export function parseProjectCsv(text: string, overrides: ColumnOverride[] = []): ProjectCsvParse {
  const rawLines = text.split(/\r?\n/);
  const headerIndex = rawLines.findIndex((l) => l.trim().length > 0);
  if (headerIndex === -1) {
    return { columns: [], entries: [], issues: [{ code: 'EMPTY_FILE', line: null }], dataLines: 0 };
  }

  const delimiter = detectDelimiter(rawLines[headerIndex] ?? '');
  const headers = splitCsvLine(rawLines[headerIndex] ?? '', delimiter);
  const columns = detectColumns(headers, overrides);
  const issues: CsvIssue[] = columns
    .filter((c) => c.field === null && c.header !== '')
    .map((c) => ({ code: 'UNKNOWN_COLUMN' as const, line: headerIndex + 1, column: c.header }));

  const at = indexByField(columns);
  if (at.shot === undefined) {
    issues.unshift({ code: 'MISSING_SHOT_COLUMN', line: headerIndex + 1 });
    return { columns, entries: [], issues, dataLines: 0 };
  }

  const entries: ParsedEntry[] = [];
  const byKey = new Map<string, ParsedEntry>();
  let dataLines = 0;

  for (let i = headerIndex + 1; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? '';
    if (raw.trim().length === 0) continue;
    const line = i + 1;
    if (dataLines >= MAX_DATA_LINES) {
      issues.push({ code: 'TOO_MANY_ROWS', line, value: String(MAX_DATA_LINES) });
      break;
    }
    dataLines++;
    const fields = splitCsvLine(raw, delimiter);
    const read = (field: keyof typeof at): string => {
      const index = at[field];
      return index === undefined ? '' : (fields[index] ?? '').trim();
    };
    const headerOf = (field: keyof typeof at): string | undefined =>
      columns.find((c) => c.field === field)?.header;

    const shot = read('shot');
    if (!shot) {
      issues.push({ code: 'MISSING_SHOT', line, column: headerOf('shot') });
      continue;
    }
    const sequence = read('sequence') || null;
    const key = entryKey(sequence, shot);
    const existing = byKey.get(key);
    const entry = existing ?? newEntry(line, sequence, shot, read('episode') || null);
    if (!existing) {
      byKey.set(key, entry);
      entries.push(entry);
    } else entry.lines.push(line);

    readShotFields(entry, line, read, headerOf, Boolean(existing));
    readTasks(entry, line, read, headerOf);
  }

  return { columns, entries, issues, dataLines };
}

function newEntry(line: number, sequence: string | null, shot: string, episode: string | null): ParsedEntry {
  return {
    line,
    lines: [line],
    episode,
    sequence,
    shot,
    name: null,
    description: null,
    tags: [],
    status: null,
    startFrame: null,
    endFrame: null,
    frames: null,
    tasks: [],
    issues: [],
  };
}

type Reader = (field: CsvField) => string;
type HeaderOf = (field: CsvField) => string | undefined;

/** Champs de plan. Sur une ligne de fusion, la première valeur non vide fait foi. */
function readShotFields(
  entry: ParsedEntry,
  line: number,
  read: Reader,
  headerOf: HeaderOf,
  merging: boolean,
): void {
  const text = (field: CsvField, max = MAX_NAME) => {
    const raw = read(field);
    if (!raw) return null;
    if (raw.length <= max) return raw;
    entry.issues.push({ code: 'TRUNCATED_VALUE', line, column: headerOf(field), shot: entry.shot });
    return raw.slice(0, max);
  };
  const assign = (current: string | null, value: string | null, field: CsvField): string | null => {
    if (value === null) return current;
    if (current === null) return value;
    if (merging && current !== value)
      entry.issues.push({
        code: 'CONFLICTING_VALUE',
        line,
        column: headerOf(field),
        value: clip(value),
        shot: entry.shot,
      });
    return current;
  };

  entry.name = assign(entry.name, text('name'), 'name');
  entry.description = assign(entry.description, text('description', MAX_DESCRIPTION), 'description');
  entry.status = assign(entry.status, text('shotStatus'), 'shotStatus');
  entry.episode = assign(entry.episode, text('episode'), 'episode');
  for (const tag of multi(read('tags'))) if (!entry.tags.includes(tag)) entry.tags.push(tag);

  const number = (field: 'startFrame' | 'endFrame' | 'frames') => {
    const raw = read(field);
    if (!raw) return null;
    const parsed = parseCsvInteger(raw);
    if (parsed === null) {
      entry.issues.push({
        code: 'INVALID_NUMBER',
        line,
        column: headerOf(field),
        value: clip(raw),
        shot: entry.shot,
      });
      return null;
    }
    return parsed;
  };
  entry.startFrame ??= number('startFrame');
  entry.endFrame ??= number('endFrame');
  entry.frames ??= number('frames');
}

/** Tâches de la ligne. Les colonnes de tâche s'appliquent à toutes celles de la cellule. */
function readTasks(entry: ParsedEntry, line: number, read: Reader, headerOf: HeaderOf): void {
  const names = multi(read('task'));
  if (names.length === 0) return;
  const date = (field: 'startDate' | 'dueDate') => {
    const raw = read(field);
    if (!raw) return null;
    const parsed = parseCsvDate(raw);
    if (parsed === null)
      entry.issues.push({
        code: 'INVALID_DATE',
        line,
        column: headerOf(field),
        value: clip(raw),
        shot: entry.shot,
      });
    return parsed;
  };
  const shared = {
    department: read('department') || null,
    status: read('taskStatus') || null,
    assignee: read('assignee') || null,
    startDate: date('startDate'),
    dueDate: date('dueDate'),
  };
  for (const name of names) {
    const clash = entry.tasks.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      entry.issues.push({
        code: 'DUPLICATE_TASK',
        line,
        column: headerOf('task'),
        value: clip(name),
        shot: entry.shot,
      });
      continue;
    }
    entry.tasks.push({ line, name: name.slice(0, MAX_NAME), ...shared });
  }
}

/**
 * Plage de frames d'un plan, une fois les trois colonnes confrontées.
 *
 * `frames` (durée) complète ce qui manque plutôt que de le contredire : avec un début, la
 * fin s'en déduit ; sans début, le premier frame du projet sert d'origine. Si les trois
 * sont là et se contredisent, la plage explicite gagne et l'écart est signalé — c'est la
 * durée qu'un tableur recalcule mal, pas les bornes que l'éditorial a écrites.
 */
export function resolveFrameRange(
  entry: ParsedEntry,
  projectStartFrame: number,
): { startFrame: number | null; endFrame: number | null; issue: CsvIssue | null } {
  const { startFrame, endFrame, frames } = entry;
  if (frames !== null && frames > 0) {
    if (startFrame !== null && endFrame !== null) {
      const expected = endFrame - startFrame + 1;
      return {
        startFrame,
        endFrame,
        issue:
          expected === frames
            ? null
            : { code: 'FRAME_RANGE_MISMATCH', line: entry.line, value: String(frames), shot: entry.shot },
      };
    }
    if (startFrame !== null) return { startFrame, endFrame: startFrame + frames - 1, issue: null };
    if (endFrame !== null) return { startFrame: endFrame - frames + 1, endFrame, issue: null };
    return { startFrame: projectStartFrame, endFrame: projectStartFrame + frames - 1, issue: null };
  }
  return { startFrame, endFrame, issue: null };
}
