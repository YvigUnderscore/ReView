// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Version of the instance.
 *
 * Two installations made on two different dates were indistinguishable: neither the API, nor the
 * probe, nor the administration screen said which version of ReView was running. Without this, no
 * remote diagnosis is possible, and AGPL §13 requires offering the *corresponding* source code,
 * which presumes knowing which commit it corresponds to.
 *
 * Three sources, in order of precedence:
 *
 *  1. `APP_VERSION` / `GIT_SHA` / `BUILD_DATE` from the environment, set by `scripts/install.sh`
 *     and `scripts/update.sh` in `.env` (which compose loads into the backend AND the worker), or
 *     injected at image build time;
 *  2. the `version` of the `package.json` embedded in the image, which always exists;
 *  3. `0.0.0-unknown`, never reached in practice but preferable to an exception.
 *
 * Direct reading of `process.env`, not of the Zod schema in `config/env.ts`: these three values
 * are purely informative; they must neither make startup fail when missing (the normal case in
 * development), nor oblige the operator to set them. The schema refuses what it does not know;
 * here, everything is optional.
 */

export interface VersionInfo {
  /** SemVer version of the application (`2.1.0`), without the `v` of the git tag. */
  version: string;
  /** Short commit of the build, when known. */
  commit: string | null;
  /** ISO timestamp of the image build, when known. */
  builtAt: string | null;
}

export const UNKNOWN_VERSION = '0.0.0-unknown';

/** Cleans an environment value: empty, `unknown` and blank values are worth nothing. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
  return trimmed;
}

/**
 * Normalizes a version: `v2.1.0` and `2.1.0` designate the same thing; the git tag carries the
 * `v` by convention, not the version.
 */
export function normalizeVersion(value: string | null): string | null {
  if (!value) return null;
  return /^v\d/i.test(value) ? value.slice(1) : value;
}

/** Decomposed version: numeric core and pre-release identifiers. */
function parseSemver(value: string): { core: number[]; pre: string[] } {
  const normalized = normalizeVersion(value.trim()) ?? '0';
  // Build metadata (`+abc`) NEVER takes part in ordering (SemVer §10).
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
 * Orders two versions: negative if `a` precedes `b`, positive if it follows it, 0 if they designate
 * the same. This is what decides whether a release is "available".
 *
 * Two traps, both visible on screen the day they occur:
 *  - the comparison is **numeric field by field**, never lexicographic: otherwise "2.10.0" precedes
 *    "2.9.0" and the instance believes itself up to date at the wrong time;
 *  - a **pre-release precedes** the stable version of the same core (SemVer §11.4.3): an instance
 *    at `2.4.0-rc.1` must see `2.4.0` arrive, not believe itself ahead.
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
    // A shorter set of identifiers precedes the one that extends it (`rc.1` < `rc.1.2`).
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    // A numeric identifier always precedes an alphanumeric identifier.
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** Short commit (12 characters): a full SHA is not readable in an interface. */
export function shortCommit(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 12).toLowerCase() : value.slice(0, 40);
}

/** Resolves the version from an environment and the package version. */
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
 * Walks up the tree from `startDir` until it finds a readable `package.json`.
 * Code runs from `dist/lib/` in production and from `src/lib/` in development: the depth is not
 * the same, so we search rather than count the `..`.
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
      // No package.json here (or unreadable): keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Version of this process, resolved once at load time. */
export const appVersion: VersionInfo = resolveVersion(process.env, readPackageVersion(__dirname));

/** Compact string for logs and the `X-ReView-Version` header. */
export function versionLabel(info: VersionInfo = appVersion): string {
  return info.commit ? `${info.version}+${info.commit}` : info.version;
}
