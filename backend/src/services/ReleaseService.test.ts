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

/** Une release telle que l'API GitHub la rend. */
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
  it('ordonne par version, ignore brouillons et étiquettes qui n’en sont pas', async () => {
    safeFetch.mockResolvedValue(
      ok([
        release('v2.9.0'),
        release('v2.10.0'),
        release('v2.11.0', { draft: true }),
        release('nightly-2026-09-01'),
      ]),
    );
    const result = await catalog();
    // Ordre numérique : « v2.10.0 » suit « v2.9.0 », ce que l'ordre du texte inverserait.
    expect(result.releases.map((r) => r.tag)).toEqual(['v2.10.0', 'v2.9.0']);
    expect(result.error).toBeNull();
    expect(result.checkedAt).not.toBeNull();
  });

  it('ne demande rien quand la vérification est coupée', async () => {
    config.enabled = false;
    await expect(catalog()).resolves.toEqual({ releases: [], checkedAt: null, error: 'DISABLED' });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('traduit un quota épuisé en donnée, pas en incident', async () => {
    safeFetch.mockResolvedValue({ status: 403, ok: false, json: () => Promise.resolve({}) });
    await expect(catalog()).resolves.toMatchObject({ error: 'RATE_LIMITED', releases: [] });
  });

  it('traduit une panne réseau en « injoignable » sans jeter', async () => {
    // Un studio dont le pare-feu ferme le sortant doit voir un écran qui explique, pas une
    // page d'administration en erreur.
    safeFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(catalog()).resolves.toEqual({ releases: [], checkedAt: null, error: 'UNREACHABLE' });
  });

  it('sert le cache, et le rafraîchit sur demande explicite', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.9.0')]));
    await catalog();
    await catalog();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    await catalog({ force: true });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it('garde ce qu’il sait quand une vérification ultérieure échoue', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.9.0')]));
    await catalog();
    safeFetch.mockRejectedValue(new Error('coupure'));
    const result = await catalog({ force: true });
    expect(result.releases.map((r) => r.tag)).toEqual(['v2.9.0']);
    expect(result.error).toBe('UNREACHABLE');
  });

  it('joint le jeton quand il y en a un, et jamais autrement', async () => {
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

  it('ne suit pas une réponse qui n’a pas la forme attendue', async () => {
    safeFetch.mockResolvedValue(ok({ message: 'Not Found' }));
    await expect(catalog()).resolves.toMatchObject({ error: 'UNREACHABLE' });
  });
});

describe('choix de la version', () => {
  const releases = [
    { tag: 'v2.5.0-rc.1', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: true },
    { tag: 'v2.4.0', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: false },
    { tag: 'v2.3.0', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: false },
  ];

  it('ne propose jamais une pré-version d’un bouton', () => {
    expect(latestOf(releases)?.tag).toBe('v2.4.0');
  });

  it('énumère ce qui est paru depuis la version en service', () => {
    // C'est la réponse à « qu'est-ce que ça change ? » : toutes les versions sautées, pas
    // seulement la dernière.
    expect(newerThan(releases, '2.3.0').map((r) => r.tag)).toEqual(['v2.5.0-rc.1', 'v2.4.0']);
    expect(newerThan(releases, '2.4.0').map((r) => r.tag)).toEqual(['v2.5.0-rc.1']);
    expect(newerThan(releases, '2.5.0')).toEqual([]);
  });
});

describe('isPublishedTag', () => {
  it('refuse ce qui n’a pas la forme d’une étiquette, sans rien demander', async () => {
    await expect(isPublishedTag('v2.4.0; rm -rf /')).resolves.toBe(false);
    await expect(isPublishedTag('../../etc/passwd')).resolves.toBe(false);
    await expect(isPublishedTag('latest')).resolves.toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('refuse une étiquette bien formée mais jamais publiée', async () => {
    safeFetch.mockResolvedValue(ok([release('v2.4.0')]));
    await expect(isPublishedTag('v2.4.0')).resolves.toBe(true);
    await expect(isPublishedTag('v9.9.9')).resolves.toBe(false);
  });
});
