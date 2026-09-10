// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le catalogue est mimé plutôt que lu : ce qui est vérifié ici est le **mécanisme** —
 * traduire par le code, se rabattre sur le message du serveur — et non le contenu du
 * catalogue, qui vit dans `messages/*.json` et bouge à chaque lot de traduction.
 */
const TRANSLATED: Record<string, (p: Record<string, unknown>) => string> = {
  'error.PROJECT_ARCHIVED': () => 'Le projet est archivé',
  'error.SHOTGRID_AUTH_REFUSED': (p) => `Identifiants refusés : ${String(p.reason ?? '')}`,
};

vi.mock('../v2/i18n', () => ({
  hasMessage: (key: string) => key in TRANSLATED,
  t: (key: string, params?: Record<string, unknown>) =>
    TRANSLATED[key]?.(params ?? {}) ?? `${key}(${JSON.stringify(params ?? {})})`,
}));

const { ApiError, api, apiErrorMessage } = await import('./apiClient');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const errorResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
});

describe('apiErrorMessage', () => {
  it('traduit par le code : le message anglais du serveur reste une trace', () => {
    const body = { error: 'Project is archived', code: 'PROJECT_ARCHIVED' };
    expect(apiErrorMessage(body, 403)).toBe('Le projet est archivé');
  });

  it('code pas encore traduit : affiche le message du serveur, jamais la clé', () => {
    const body = { error: 'Version already published', code: 'PUBLISHED_LOCKED' };
    expect(apiErrorMessage(body, 403)).toBe('Version already published');
  });

  it('réponse sans code : affiche le message du serveur', () => {
    expect(apiErrorMessage({ error: 'Something odd' }, 400)).toBe('Something odd');
  });

  it('réponse vide : message générique portant le statut', () => {
    expect(apiErrorMessage({}, 502)).toBe('common.error.http({"status":502})');
  });

  /**
   * Traduire par le code effaçait ce que le serveur disait de précis : « compte
   * verrouillé » redevenait « refus d'authentification », et le lecteur repartait dans les
   * journaux. Les détails de la faute nourrissent donc la phrase traduite.
   */
  it('les détails du serveur nourrissent le message traduit', () => {
    const reason = "Can't authenticate user 'demo' because the account is locked.";
    expect(
      apiErrorMessage(
        { error: `ShotGrid refused the credentials: ${reason}`, code: 'SHOTGRID_AUTH_REFUSED', reason },
        502,
      ),
    ).toBe(`Identifiants refusés : ${reason}`);
  });
});

describe('api — erreur levée', () => {
  it('porte le statut et le code, et un message déjà traduit', async () => {
    mockFetch.mockResolvedValue(
      errorResponse({ error: 'Project is archived', code: 'PROJECT_ARCHIVED' }, 403),
    );
    const error = await api.get('/api/projects/1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'PROJECT_ARCHIVED', message: 'Le projet est archivé' });
  });

  it('sans corps JSON : ni code ni message serveur, mais un statut', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    const error = (await api.get('/x').catch((e: unknown) => e)) as InstanceType<typeof ApiError>;

    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
  });
});
