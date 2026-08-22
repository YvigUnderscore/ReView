// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../../i18n';

/**
 * Identité de l'instance : forme de `GET /api/version` et mise en forme associée.
 *
 * Fonctions pures dans leur propre module (comme `adminShared`, `adminStorage`…) : le
 * composant ne doit exporter que lui-même, et ces deux règles d'affichage se testent sans
 * monter de React.
 */

/** Réponse de `GET /api/version` (backend/src/routes/health.routes.ts). */
export interface InstanceVersion {
  version: string;
  commit: string | null;
  builtAt: string | null;
  node: string;
  source: string;
}

/** Date de construction lisible ; l'ISO brute est illisible et la valeur peut manquer. */
export function formatBuildDate(iso: string | null, locale: string = intlLocale()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Version affichable : `2.3.0 (a1b2c3d4e5f6)` quand le commit est connu. */
export function displayVersion(info: Pick<InstanceVersion, 'version' | 'commit'>): string {
  return info.commit ? `${info.version} (${info.commit})` : info.version;
}
