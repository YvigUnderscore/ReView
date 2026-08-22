// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Notes de review au format tableur.
 *
 * Une ligne par note (réponses comprises, rattachées par `reply_to`), dans l'ordre où la
 * review les présente. Le format suit exactement la convention du CSV pipeline
 * (`projectCsv.ts`) : séparateur `,`, UTF-8 sans BOM, fin de ligne `\n`, en-tête en
 * minuscules — un fichier lisible par Excel, Numbers et Sheets, et ré-exploitable par un
 * script.
 *
 * Sérialisation PURE : aucune dépendance Prisma ni MinIO, le service fournit des lignes
 * déjà résolues. C'est ce qui rend le format testable sans base.
 */

/**
 * Colonnes, dans l'ordre. `frame` est la frame **affichée** (base `startFrame` du projet,
 * celle que l'artiste lit à l'écran) ; `timecode` est le timecode interne du média
 * (00:00:00:00 = premier photogramme), celui que le montage attend.
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

/** Une note prête à écrire : toutes les valeurs sont déjà des chaînes. */
export type NoteCsvRow = Record<NotesCsvColumn, string>;

/**
 * Échappe un champ CSV et neutralise l'injection de formule tableur : un champ commençant
 * par `= + - @` (ou tab/CR) est préfixé d'une apostrophe pour qu'Excel/Sheets ne
 * l'interprète pas comme une formule. Même règle que `projectCsv.csvField` — le texte
 * d'une note est saisi par l'utilisateur, donc exactement la donnée qu'on ne veut pas voir
 * exécutée à l'ouverture du fichier.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Aplatit un texte de note pour la cellule : le contenu est du HTML assaini côté service,
 * mais les retours à la ligne restent, et une cellule multi-lignes rend le fichier
 * pénible à trier. On garde un séparateur lisible plutôt que de perdre la structure.
 */
export function flattenNoteText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ⏎ ');
}

/** Sérialise les notes au format CSV (en-tête inclus). */
export function toNotesCsv(rows: NoteCsvRow[]): string {
  const lines = [NOTES_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(NOTES_CSV_COLUMNS.map((c) => csvField(row[c] ?? '')).join(','));
  }
  return lines.join('\n');
}
