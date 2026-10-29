// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The catalog is mocked rather than read: what is verified here is the **mechanism**:
 * translating by code, falling back to the server message, and not the content of the
 * catalog, which lives in `messages/*.json` and changes with each translation batch.
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
  it('translates by code: the English server message stays only as a trace', () => {
    const body = { error: 'Project is archived', code: 'PROJECT_ARCHIVED' };
    expect(apiErrorMessage(body, 403)).toBe('Le projet est archivé');
  });

  it('untranslated code: shows the server message, never the key', () => {
    const body = { error: 'Version already published', code: 'PUBLISHED_LOCKED' };
    expect(apiErrorMessage(body, 403)).toBe('Version already published');
  });

  it('response without code: shows the server message', () => {
    expect(apiErrorMessage({ error: 'Something odd' }, 400)).toBe('Something odd');
  });

  it('empty response: generic message carrying the status', () => {
    expect(apiErrorMessage({}, 502)).toBe('common.error.http({"status":502})');
  });

  /**
   * Translating by code erased what the server said precisely: "account
   * locked" became "authentication refused" again, and the reader went back to the
   * logs. The details of the failure therefore feed the translated sentence.
   */
  it('the server details feed the translated message', () => {
    const reason = "Can't authenticate user 'demo' because the account is locked.";
    expect(
      apiErrorMessage(
        { error: `ShotGrid refused the credentials: ${reason}`, code: 'SHOTGRID_AUTH_REFUSED', reason },
        502,
      ),
    ).toBe(`Identifiants refusés : ${reason}`);
  });
});

describe('api — thrown error', () => {
  it('carries the status and the code, and an already translated message', async () => {
    mockFetch.mockResolvedValue(
      errorResponse({ error: 'Project is archived', code: 'PROJECT_ARCHIVED' }, 403),
    );
    const error = await api.get('/api/projects/1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'PROJECT_ARCHIVED', message: 'Le projet est archivé' });
  });

  it('without a JSON body: neither server code nor message, but a status', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    const error = (await api.get('/x').catch((e: unknown) => e)) as InstanceType<typeof ApiError>;

    expect(error.status).toBe(500);
    expect(error.code).toBeUndefined();
  });
});
