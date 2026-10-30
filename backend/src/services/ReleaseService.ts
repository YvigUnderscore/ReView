// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { safeFetch } from '../lib/safeFetch';
import { appVersion, compareSemver } from '../lib/version';

/**
 * Published ReView versions, as the administration screen lists them.
 *
 * This service updates nothing: it **answers the question "what's new"**, which is the useful
 * half of the screen. It works on every instance, including those with no update mechanism installed.
 *
 * Three principles:
 *
 *  1. **`safeFetch`, never a bare `fetch`** (see the header of `lib/safeFetch.ts`): the
 *     backend lives on the application network where MinIO, Redis and Postgres answer without
 *     authentication. `RELEASE_REPO` comes from an operator's `.env`, so it is untrusted.
 *  2. **No exception propagates.** A studio whose firewall blocks outbound traffic must see
 *     "unreachable", not an error page in the admin area. Unavailability is data in the
 *     response, not an incident.
 *  3. **Release notes are remote markdown**, so it is content we do not write: its size is
 *     bounded here, and it is rendered escaped in the browser (`renderDocHtml`).
 */

/** A published release, reduced to what the screen displays. */
export interface ReleaseInfo {
  /** Git tag, as published (`v2.4.0`). */
  tag: string;
  name: string;
  publishedAt: string | null;
  /** Release notes in markdown: the body of the GitHub release. */
  notesMd: string;
  htmlUrl: string;
  prerelease: boolean;
}

/** Why the catalog is empty, when it is. */
export type ReleaseError = 'DISABLED' | 'UNREACHABLE' | 'RATE_LIMITED';

export interface ReleaseCatalog {
  releases: ReleaseInfo[];
  /** Timestamp of the last successful poll; `null` if none. */
  checkedAt: string | null;
  error: ReleaseError | null;
}

/** Publishable version tag, in the same form that triggers `release.yml`. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** Release bodies are prose: bounded so a remote repository cannot inflate them. */
const MAX_NOTES_CHARS = 20_000;
/** Freshness window: a release is not re-fetched more than once in half an hour. */
const TTL_MS = 30 * 60_000;
/** Requested releases: enough to cover several versions of lag without pagination. */
const PAGE_SIZE = 20;

const githubRelease = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  published_at: z.string().nullish(),
  body: z.string().nullish(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

let cache: ReleaseCatalog | null = null;
let cachedAtMs = 0;

/** Clears the cache. Called by "Check now" and by the tests. */
export function invalidate(): void {
  cache = null;
  cachedAtMs = 0;
}

/** Queries GitHub. Never throws: maps any failure to a `ReleaseError`. */
async function fetchReleases(): Promise<ReleaseCatalog> {
  const url = `https://api.github.com/repos/${env.RELEASE_REPO}/releases?per_page=${PAGE_SIZE}`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': `ReView/${appVersion.version}`,
  };
  if (env.RELEASE_GITHUB_TOKEN) headers.authorization = `Bearer ${env.RELEASE_GITHUB_TOKEN}`;

  try {
    const res = await safeFetch(
      url,
      { headers },
      // A redirect: a renamed repository answers 301 with its new name, and the SSRF guard
      // rechecks the target of each hop. 512 KiB: twenty release bodies fit comfortably.
      { timeoutMs: 8_000, maxRedirects: 1, maxBytes: 512 * 1024 },
    );
    if (res.status === 403 || res.status === 429) {
      return { releases: [], checkedAt: null, error: 'RATE_LIMITED' };
    }
    if (!res.ok) return { releases: [], checkedAt: null, error: 'UNREACHABLE' };

    const parsed = z.array(githubRelease).safeParse(await res.json());
    if (!parsed.success) return { releases: [], checkedAt: null, error: 'UNREACHABLE' };

    const releases = parsed.data
      .filter((r) => r.draft !== true && VERSION_TAG.test(r.tag_name))
      .map((r) => ({
        tag: r.tag_name,
        name: r.name?.trim() || r.tag_name,
        publishedAt: r.published_at ?? null,
        notesMd: (r.body ?? '').slice(0, MAX_NOTES_CHARS),
        htmlUrl: r.html_url,
        prerelease: r.prerelease === true,
      }))
      .sort((a, b) => compareSemver(b.tag, a.tag));
    return { releases, checkedAt: new Date().toISOString(), error: null };
  } catch (err) {
    logger.warn({ err, repo: env.RELEASE_REPO }, '[Release] catalogue injoignable');
    return { releases: [], checkedAt: null, error: 'UNREACHABLE' };
  }
}

/** The release catalog, served from cache while it is fresh. */
export async function catalog(options: { force?: boolean } = {}): Promise<ReleaseCatalog> {
  if (!env.RELEASE_CHECK_ENABLED) return { releases: [], checkedAt: null, error: 'DISABLED' };
  const fresh = cache !== null && Date.now() - cachedAtMs < TTL_MS;
  if (fresh && !options.force) return cache as ReleaseCatalog;

  const fetched = await fetchReleases();
  // A transient failure must not erase a catalog already obtained: the screen keeps
  // showing what it knows, noting that the last check did not succeed.
  if (fetched.error !== null && cache !== null && cache.releases.length > 0) {
    cache = { ...cache, error: fetched.error };
    return cache;
  }
  cache = fetched;
  cachedAtMs = Date.now();
  return cache;
}

/**
 * The release to offer: the highest **stable** version. A pre-release stays visible in the
 * list: it is not offered by a button, nor is it hidden.
 */
export function latestOf(releases: ReleaseInfo[]): ReleaseInfo | null {
  return releases.find((r) => !r.prerelease) ?? null;
}

/** Releases published since the installed version: what the update would bring. */
export function newerThan(releases: ReleaseInfo[], installed: string): ReleaseInfo[] {
  return releases.filter((r) => compareSemver(r.tag, installed) > 0);
}

/**
 * Rejects a tag that was not published. This is an ERGONOMICS check: it prevents switching to a
 * nonexistent version, whose failure would only show after the backup. The security guard is on
 * the agent side (version monotonicity): this check relies on a remote response, so on something
 * we do not control.
 */
export async function isPublishedTag(tag: string): Promise<boolean> {
  if (!VERSION_TAG.test(tag)) return false;
  const { releases } = await catalog();
  return releases.some((r) => r.tag === tag);
}
