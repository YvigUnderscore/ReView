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
 * Enriched reading of a pipeline CSV: episode, sequence, shot, sheet, frame range, tasks, department, status, assignment and dates.
 *
 * Two stances drawn from the real shape of tracker exports:
 *
 * 1. **One row per task is the norm.** ShotGrid, ftrack and Kitsu export the shot as many times as it has tasks. Rows designating
 *    the same shot are therefore MERGED, never rejected as duplicates — rejection was the defect.
 * 2. **No plain-text messages.** Every anomaly is a code (`CsvIssueCode`) accompanied by the row, the column and the faulty value:
 *    it is the interface that writes it, in the reader's language, and the downloadable report follows from it.
 *
 * PURE module: no Prisma dependency, fully testable.
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

/** A localised anomaly. `line` is the line number in the file (1 = header). */
export interface CsvIssue {
  code: CsvIssueCode;
  line: number | null;
  /** Header of the faulty column, as written in the file. */
  column?: string;
  /** Refused value, truncated to 80 characters so as not to swell the response. */
  value?: string;
  /** Code of the shot concerned, to find the row in a sorted spreadsheet. */
  shot?: string;
}

export interface ParsedTaskRow {
  line: number;
  name: string;
  department: string | null;
  status: string | null;
  assignee: string | null;
  /** Date in ISO `YYYY-MM-DD` format, already validated. */
  startDate: string | null;
  dueDate: string | null;
}

/** A shot and everything the file says about it, once its rows are merged. */
export interface ParsedEntry {
  /** First line of the file that describes this shot. */
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
  /** File anomalies and rejected rows (those that produce no shot). */
  issues: CsvIssue[];
  /** Number of data rows read, header excluded. */
  dataLines: number;
}

/** Beyond this, we refuse to read: a file of this size is no longer a migration. */
const MAX_DATA_LINES = 20_000;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 4000;

const clip = (v: string) => (v.length > 80 ? `${v.slice(0, 80)}…` : v);

/**
 * Non-negative integer read from a cell. `1 001` and `1,001` come from spreadsheets:
 * spaces (including non-breaking ones) and thousands separators are removed.
 */
export function parseCsvInteger(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}

/**
 * Date of a cell, normalised to ISO `YYYY-MM-DD`.
 *
 * Four accepted notations: `YYYY-MM-DD` (and `YYYY/MM/DD`), then `DD/MM/YYYY`, `DD-MM-YYYY` and `DD.MM.YYYY`. Day first, not month:
 * `03/04/2026` is 3 April everywhere except in the United States, and guessing case by case would silently shift deadlines. The
 * American format is converted before import — the documentation says so.
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

/** Multiple values of a cell (`Anim|Comp`) — the vertical bar, never the delimiter. */
function multi(raw: string): string[] {
  return raw
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Merge key of a shot: the sequence and the code, case-insensitive. */
const entryKey = (sequence: string | null, shot: string) =>
  `${(sequence ?? '').toLowerCase()}::${shot.toLowerCase()}`;

/**
 * Reads the file. `overrides` imposes the column match decided by the user when the header is not enough.
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

/** Shot fields. On a merge row, the first non-empty value is authoritative. */
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

/** Tasks of the row. Task columns apply to all those in the cell. */
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
 * Frame range of a shot, once the three columns are compared.
 *
 * `frames` (duration) completes what is missing rather than contradicting it: with a start, the end follows; without a start, the
 * project's first frame serves as origin. If all three are present and contradict each other, the explicit range wins and the gap is
 * flagged — it is the duration that a spreadsheet recalculates badly, not the bounds the editorial wrote.
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
