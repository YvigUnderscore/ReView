// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Review notes in spreadsheet format.
 *
 * One line per note (replies included, attached by `reply_to`), in the order the review presents them. The format
 * follows exactly the convention of the pipeline CSV (`projectCsv.ts`): `,` separator, UTF-8 without BOM, `\n` line
 * end, lowercase header — a file readable by Excel, Numbers and Sheets, and reusable by a script.
 *
 * PURE serialisation: no Prisma or MinIO dependency, the service supplies already-resolved rows. This is what makes the
 * format testable without a database.
 */

/**
 * Columns, in order. `frame` is the **displayed** frame (based on the project's `startFrame`, the one the artist reads
 * on screen); `timecode` is the media's internal timecode (00:00:00:00 = first frame), the one the editorial expects.
 */
export const NOTES_CSV_COLUMNS = [
  'note_id',
  'reply_to',
  'sequence',
  'shot',
  'task',
  'version',
  'media',
  'frame',
  'timecode',
  'range_frames',
  'author',
  'created_at',
  'state',
  'resolved',
  'resolved_by',
  'assignee',
  'decision',
  'client_visible',
  'annotated',
  'content',
] as const;

export type NotesCsvColumn = (typeof NOTES_CSV_COLUMNS)[number];

/** A note ready to write: all values are already strings. */
export type NoteCsvRow = Record<NotesCsvColumn, string>;

/**
 * Escapes a CSV field and neutralises spreadsheet formula injection: a field starting with `= + - @` (or tab/CR) is
 * prefixed with an apostrophe so that Excel/Sheets does not interpret it as a formula. Same rule as
 * `projectCsv.csvField` — the text of a note is typed by the user, hence exactly the data we do not want executed when
 * the file is opened.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Flattens a note text for the cell: the content is HTML sanitised on the service side, but line breaks remain, and a
 * multi-line cell makes the file painful to sort. We keep a readable separator rather than losing the structure.
 */
export function flattenNoteText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ⏎ ');
}

/** Serialises the notes to CSV format (header included). */
export function toNotesCsv(rows: NoteCsvRow[]): string {
  const lines = [NOTES_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(NOTES_CSV_COLUMNS.map((c) => csvField(row[c] ?? '')).join(','));
  }
  return lines.join('\n');
}
