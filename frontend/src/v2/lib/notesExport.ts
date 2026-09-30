// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getToken } from '../../lib/apiClient';
import { t } from '../i18n';

/**
 * Téléchargement des notes de review (CSV, EDL, OTIO, planche imprimable).
 *
 * Un export est un fichier, pas une ressource à mettre en cache : il passe par `fetch` +
 * blob plutôt que par TanStack Query, exactement comme l'export CSV du projet
 * (`ProjectCsvActions`). Un simple `<a href>` ne conviendrait pas — la route est
 * authentifiée par en-tête `Authorization`, qu'une navigation ne porte pas.
 *
 * Le module est partagé : la review y branche le CSV et la planche, une playlist ou un
 * montage y branchent en plus l'EDL et l'OTIO.
 */

/** Ce sur quoi porte l'export. */
export type NotesScope = 'media' | 'version' | 'shot' | 'playlist' | 'timeline';

/** Format demandé. `sheet` est la planche HTML imprimable (→ PDF depuis le navigateur). */
export type NotesFormat = 'csv' | 'edl' | 'otio' | 'sheet';

const EXTENSIONS: Record<NotesFormat, string> = { csv: 'csv', edl: 'edl', otio: 'otio', sheet: 'html' };

export interface NotesExportRequest {
  scope: NotesScope;
  id: number;
  format: NotesFormat;
}

export interface NotesExportResult {
  filename: string;
  /** Le plafond de notes a mordu côté serveur : le fichier est incomplet. */
  truncated: boolean;
}

/** Chemin d'API d'un export — exposé pour les tests et les liens de débogage. */
export const notesExportPath = ({ scope, id, format }: NotesExportRequest): string =>
  `/api/comments/export?scope=${scope}&id=${id}&format=${format}`;

/** Nom de fichier annoncé par le serveur, sinon un nom construit localement. */
function filenameFrom(header: string | null, req: NotesExportRequest): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? `notes-${req.scope}-${req.id}.${EXTENSIONS[req.format]}`;
}

/** Déclenche le téléchargement du fichier dans le navigateur. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Révoquer dans le même tour de boucle annule le téléchargement sur certains
  // navigateurs : on laisse le clic partir d'abord.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Télécharge les notes de la portée demandée. Lève une `Error` traduite en cas d'échec. */
export async function downloadNotes(req: NotesExportRequest): Promise<NotesExportResult> {
  const token = getToken();
  const res = await fetch(notesExportPath(req), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? t('notesExport.failed'));
  }
  const filename = filenameFrom(res.headers.get('content-disposition'), req);
  saveBlob(await res.blob(), filename);
  return { filename, truncated: res.headers.get('x-notes-truncated') === '1' };
}
