// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, safeFetch } = vi.hoisted(() => ({
  config: { enabled: true, repo: 'YvigUnderscore/ReView', token: undefined as string | undefined },
  safeFetch: vi.fn(),
}));

vi.mock('../config/env', () => ({
  env: {
    get RELEASE_CHECK_ENABLED() {
      return config.enabled;
    },
    get RELEASE_REPO() {
      return config.repo;
    },
    get RELEASE_GITHUB_TOKEN() {
      return config.token;
    },
  },
}));
vi.mock('../lib/safeFetch', () => ({ safeFetch }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { catalog, invalidate, isPublishedTag, latestOf, newerThan } from './ReleaseService';

/** A release as returned by the GitHub API. */
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `ReView ${tag}`,
  published_at: '2026-09-01T10:00:00Z',
  body: `## ${tag}\n\nDes changements.`,
  html_url: `https://github.com/YvigUnderscore/ReView/releases/tag/${tag}`,
  ...extra,
});

const ok = (body: unknown) => ({ status: 200, ok: true, json: () => Promise.resolve(body) });

beforeEach(() => {
  vi.clearAllMocks();
  invalidate();
  config.enabled = true;
  config.token = undefined;
});

describe('catalog', () => {
  it('sorts by version, ignores drafts and tags that are not versions', async () => {
    safeFetch.mockResolvedValue(
      ok([
        release('v2.9.0'),
        release('v2.10.0'),
        release('v2.11.0', { draft: true }),
        release('nightly-2026-09-01'),
      ]),
    );
    const result = await catalog();
    // Numeric ordering: "v2.10.0" comes after "v2.9.0", which plain text ordering would invert.
    expect(result.releases.map((r) => r.tag)).toEqual(['v2.10.0', 'v2.9.0']);
    expect(result.error).toBeNull();
    expect(result.checkedAt).not.toBeNull();
  });

  it('requests nothing when the check is switched off', async () => {
    config.enabled = false;
    await expect(catalog()).resolves.toEqual({ releases: [], checkedAt: null, error: 'DISABLED' });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('turns an exhausted quota into data, not an incident', async () => {
    safeFetch.mockResolvedValue({ status: 403, ok: false, json: () => Promise.resolve({}) });
    await expect(catalog()).resolves.toMatchObject({ error: 'RATE_LIMITED', releases: [] });
  });

  it('turns a network failure into "unreachable" without throwing', async () => {
    // A studio whose firewall blocks outbound traffic must see a screen that explains, not an
    // error page from the admin area.
    safeFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(catalog()).resolves.toEqual({ releases: [], checkedAt: null, error: 'UNREACHABLE' });
  });

  it('serves the cache, and refreshes it on explicit request', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.9.0')]));
    await catalog();
    await catalog();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    await catalog({ force: true });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps what it knows when a later check fails', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.9.0')]));
    await catalog();
    safeFetch.mockRejectedValue(new Error('coupure'));
    const result = await catalog({ force: true });
    expect(result.releases.map((r) => r.tag)).toEqual(['v2.9.0']);
    expect(result.error).toBe('UNREACHABLE');
  });

  it('attaches the token when there is one, and never otherwise', async () => {
    const headersOf = (index: number): Record<string, string> => {
      const init = safeFetch.mock.calls[index]?.[1] as { headers?: Record<string, string> } | undefined;
      return init?.headers ?? {};
    };
    safeFetch.mockResolvedValue(ok([]));
    await catalog();
    expect(headersOf(0)).not.toHaveProperty('authorization');
    config.token = 'ghp_secret';
    await catalog({ force: true });
    expect(headersOf(1).authorization).toBe('Bearer ghp_secret');
  });

  it('does not follow a response that does not have the expected shape', async () => {
    safeFetch.mockResolvedValue(ok({ message: 'Not Found' }));
    await expect(catalog()).resolves.toMatchObject({ error: 'UNREACHABLE' });
  });
});

describe('choice of version', () => {
  const releases = [
    { tag: 'v2.5.0-rc.1', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: true },
    { tag: 'v2.4.0', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: false },
    { tag: 'v2.3.0', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: false },
  ];

  it('never offers a pre-release through a button', () => {
    expect(latestOf(releases)?.tag).toBe('v2.4.0');
  });

  it('lists what has been published since the version in service', () => {
    // This answers "what changes?": all skipped versions, not just the latest one.
    expect(newerThan(releases, '2.3.0').map((r) => r.tag)).toEqual(['v2.5.0-rc.1', 'v2.4.0']);
    expect(newerThan(releases, '2.4.0').map((r) => r.tag)).toEqual(['v2.5.0-rc.1']);
    expect(newerThan(releases, '2.5.0')).toEqual([]);
  });
});

describe('isPublishedTag', () => {
  it('refuses what does not have the shape of a tag, without requesting anything', async () => {
    await expect(isPublishedTag('v2.4.0; rm -rf /')).resolves.toBe(false);
    await expect(isPublishedTag('../../etc/passwd')).resolves.toBe(false);
    await expect(isPublishedTag('latest')).resolves.toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('refuses a well-formed tag that was never published', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.4.0')]));
    await expect(isPublishedTag('v2.4.0')).resolves.toBe(true);
    await expect(isPublishedTag('v9.9.9')).resolves.toBe(false);
  });
});
