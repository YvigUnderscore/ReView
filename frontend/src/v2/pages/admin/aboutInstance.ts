// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../../i18n';

/**
 * Instance identity: the shape of `GET /api/version` and its associated formatting.
 *
 * Pure functions in their own module (like `adminShared`, `adminStorage`...): the
 * component should export only itself, and these two display rules are tested without
 * mounting React.
 */

/** Response of `GET /api/version` (backend/src/routes/health.routes.ts). */
export interface InstanceVersion {
  version: string;
  commit: string | null;
  builtAt: string | null;
  node: string;
  source: string;
}

/** Readable build date; the raw ISO is unreadable and the value may be missing. */
export function formatBuildDate(iso: string | null, locale: string = intlLocale()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Displayable version: `2.3.0 (a1b2c3d4e5f6)` when the commit is known. */
export function displayVersion(info: Pick<InstanceVersion, 'version' | 'commit'>): string {
  return info.commit ? `${info.version} (${info.commit})` : info.version;
}
