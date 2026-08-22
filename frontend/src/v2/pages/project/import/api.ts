// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from '../../../../lib/apiClient';
import { t } from '../../../i18n';
import type { ColumnOverride, ImportReport } from './types';

/** Appels de l'import CSV. Un export/gabarit est un fichier, pas une donnée à cacher. */

export interface ImportRequest {
  csv: string;
  commit: boolean;
  mapping: ColumnOverride[];
}

export function runImport(projectId: number, body: ImportRequest): Promise<ImportReport> {
  return api.post<ImportReport>(`/api/projects/${projectId}/import-csv`, body);
}

/** Déclenche le téléchargement d'un texte déjà en mémoire (rapport d'import). */
export function saveTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Révoquer dans le même tour de boucle annule le téléchargement sur certains
  // navigateurs : on laisse le clic partir d'abord.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Gabarit d'import servi par le serveur — la route est authentifiée par en-tête, qu'une
 * simple navigation ne porterait pas. Renvoie le texte pour que l'appelant décide s'il le
 * télécharge ou le colle dans la zone de saisie.
 */
export async function fetchTemplate(projectId: number): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api/projects/${projectId}/import-csv/template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(t('csvImport.templateFailed'));
  return res.text();
}

/** Export CSV des plans du projet (chemin de retour de l'import). */
export async function downloadProjectCsv(projectId: number): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/projects/${projectId}/export-csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(t('common.error.export'));
  saveTextFile(`project-${projectId}-shots.csv`, await res.text());
}
