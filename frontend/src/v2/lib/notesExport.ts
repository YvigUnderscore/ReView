// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiFetch } from './apiFetch';
import { t } from '../i18n';

/**
 * Downloading review notes (CSV, EDL, OTIO, printable sheet).
 *
 * An export is a file, not a resource to cache: it goes through `fetch` + blob rather than TanStack
 * Query, exactly like the project's CSV export (`ProjectCsvActions`). A plain `<a href>` would not
 * do — the route is authenticated by an `Authorization` header, which a navigation does not carry.
 *
 * The module is shared: review plugs in the CSV and the sheet, a playlist or an edit additionally
 * plug in the EDL and the OTIO.
 */

/** What the export applies to. */
export type NotesScope = 'media' | 'version' | 'shot' | 'playlist' | 'timeline';

/** Requested format. `sheet` is the printable HTML sheet (→ PDF from the browser). */
export type NotesFormat = 'csv' | 'edl' | 'otio' | 'sheet';

const EXTENSIONS: Record<NotesFormat, string> = { csv: 'csv', edl: 'edl', otio: 'otio', sheet: 'html' };

export interface NotesExportRequest {
  scope: NotesScope;
  id: number;
  format: NotesFormat;
}

export interface NotesExportResult {
  filename: string;
  /** The server's note cap was hit: the file is incomplete. */
  truncated: boolean;
}

/** API path of an export — exposed for tests and debugging links. */
export const notesExportPath = ({ scope, id, format }: NotesExportRequest): string =>
  `/api/comments/export?scope=${scope}&id=${id}&format=${format}`;

/** File name announced by the server, otherwise a locally built name. */
function filenameFrom(header: string | null, req: NotesExportRequest): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? `notes-${req.scope}-${req.id}.${EXTENSIONS[req.format]}`;
}

/** Triggers the download of the file in the browser. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking in the same event-loop turn cancels the download on some browsers: let the click
  // go through first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Downloads the notes for the requested scope. Throws a translated `Error` on failure. */
export async function downloadNotes(req: NotesExportRequest): Promise<NotesExportResult> {
  const res = await apiFetch(notesExportPath(req));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? t('notesExport.failed'));
  }
  const filename = filenameFrom(res.headers.get('content-disposition'), req);
  saveBlob(await res.blob(), filename);
  return { filename, truncated: res.headers.get('x-notes-truncated') === '1' };
}
