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

/** Version décomposée : noyau numérique et étiquettes de pré-version. */
function parseSemver(value: string): { core: number[]; pre: string[] } {
  const normalized = normalizeVersion(value.trim()) ?? '0';
  // Les métadonnées de construction (`+abc`) ne participent JAMAIS à l'ordre (SemVer §10).
  const plus = normalized.indexOf('+');
  const withoutBuild = plus >= 0 ? normalized.slice(0, plus) : normalized;
  const dash = withoutBuild.indexOf('-');
  const core = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild;
  const pre = dash >= 0 ? withoutBuild.slice(dash + 1) : '';
  return {
    core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
    pre: pre ? pre.split('.') : [],
  };
}

/**
 * Ordonne deux versions : négatif si `a` précède `b`, positif si elle la suit, 0 si elles
 * désignent la même. C'est ce qui décide si une release est « disponible ».
 *
 * Deux pièges, tous deux visibles à l'écran le jour où ils se produisent :
 *  - la comparaison est **numérique champ par champ**, jamais lexicographique — sinon
 *    « 2.10.0 » précède « 2.9.0 » et l'instance se croit à jour à contretemps ;
 *  - une **pré-version précède** la version stable de même noyau (SemVer §11.4.3) : une
 *    instance en `2.4.0-rc.1` doit voir arriver `2.4.0`, pas se croire en avance.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    // Un jeu d'étiquettes plus court précède celui qui le prolonge (`rc.1` < `rc.1.2`).
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    // Une étiquette numérique précède toujours une étiquette alphanumérique.
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
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
