// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Version de l'instance.
 *
 * Deux installations faites à deux dates n'étaient pas distinguables : ni l'API, ni la
 * sonde, ni l'écran d'administration ne disaient quelle version de ReView tournait. Sans
 * cela, aucun diagnostic à distance n'est possible — et l'AGPL §13 oblige à offrir le code
 * source *correspondant*, ce qui suppose de savoir à quel commit il correspond.
 *
 * Trois sources, par ordre de préséance :
 *
 *  1. `APP_VERSION` / `GIT_SHA` / `BUILD_DATE` de l'environnement — posés par
 *     `scripts/install.sh` et `scripts/update.sh` dans `.env` (que le compose charge dans
 *     le backend ET le worker), ou injectés à la construction de l'image ;
 *  2. le `version` du `package.json` embarqué dans l'image, qui existe toujours ;
 *  3. `0.0.0-unknown`, jamais atteint en pratique mais préférable à une exception.
 *
 * Lecture directe de `process.env` — et non du schéma Zod de `config/env.ts` : ces trois
 * valeurs sont purement informatives, elles ne doivent ni faire échouer le démarrage
 * quand elles manquent (le cas normal en développement), ni obliger l'exploitant à les
 * renseigner. Le schéma refuse ce qu'il ne connaît pas ; ici, tout est facultatif.
 */

export interface VersionInfo {
  /** Version SemVer de l'application (`2.1.0`), sans le `v` de l'étiquette git. */
  version: string;
  /** Commit court de la construction, quand il est connu. */
  commit: string | null;
  /** Horodatage ISO de la construction de l'image, quand il est connu. */
  builtAt: string | null;
}

export const UNKNOWN_VERSION = '0.0.0-unknown';

/** Nettoie une valeur d'environnement : vide, `unknown` et espaces ne valent rien. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
  return trimmed;
}

/**
 * Normalise une version : `v2.1.0` et `2.1.0` désignent la même chose, l'étiquette git
 * porte le `v` par convention, pas la version.
 */
export function normalizeVersion(value: string | null): string | null {
  if (!value) return null;
  return /^v\d/i.test(value) ? value.slice(1) : value;
}

/** Commit court (12 caractères) : un SHA complet ne se lit pas dans une interface. */
export function shortCommit(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 12).toLowerCase() : value.slice(0, 40);
}

/** Résout la version à partir d'un environnement et de la version du paquet. */
export function resolveVersion(environment: NodeJS.ProcessEnv, packageVersion: string | null): VersionInfo {
  return {
    version:
      normalizeVersion(clean(environment.APP_VERSION)) ??
      normalizeVersion(clean(packageVersion)) ??
      UNKNOWN_VERSION,
    commit: shortCommit(clean(environment.GIT_SHA) ?? clean(environment.GIT_COMMIT)),
    builtAt: clean(environment.BUILD_DATE),
  };
}

/**
 * Remonte l'arborescence depuis `startDir` jusqu'à trouver un `package.json` lisible.
 * Le code exécuté vit dans `dist/lib/` en production et dans `src/lib/` en développement :
 * la profondeur n'est pas la même, on cherche donc plutôt que de compter les `..`.
 */
export function readPackageVersion(startDir: string, depth = 5): string | null {
  let dir = startDir;
  for (let i = 0; i <= depth; i += 1) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version.trim()) return version.trim();
    } catch {
      // Pas de package.json ici (ou illisible) : on continue de remonter.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Version de ce process, résolue une fois au chargement. */
export const appVersion: VersionInfo = resolveVersion(process.env, readPackageVersion(__dirname));

/** Chaîne compacte pour les journaux et l'en-tête `X-ReView-Version`. */
export function versionLabel(info: VersionInfo = appVersion): string {
  return info.commit ? `${info.version}+${info.commit}` : info.version;
}
