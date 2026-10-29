// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from '@/lib/apiClient';
import { t } from '@/v2/i18n';
import type { ColumnOverride, ImportReport } from './types';

/** Calls of the CSV import. An export or template is a file, not data to hide. */

export interface ImportRequest {
  csv: string;
  commit: boolean;
  mapping: ColumnOverride[];
}

export function runImport(projectId: number, body: ImportRequest): Promise<ImportReport> {
  return api.post<ImportReport>(`/api/projects/${projectId}/import-csv`, body);
}

/** Triggers the download of a text already in memory (import report). */
export function saveTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking within the same loop tick cancels the download in some browsers, so the click is
  // allowed to go out first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Import template served by the server. The route is authenticated by header, which a simple
 * navigation would not carry. Returns the text, so that the caller decides whether to download it
 * or paste it into the input area.
 */
export async function fetchTemplate(projectId: number): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api/projects/${projectId}/import-csv/template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(t('csvImport.templateFailed'));
  return res.text();
}

/** CSV export of the project's shots (the return path of the import). */
export async function downloadProjectCsv(projectId: number): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/projects/${projectId}/export-csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(t('common.error.export'));
  saveTextFile(`project-${projectId}-shots.csv`, await res.text());
}
