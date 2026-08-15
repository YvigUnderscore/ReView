// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShotgridClient, ShotgridApiError, clearTokenCache, flattenRecord } from './ShotgridClient';

/**
 * Le client parle à un serveur simulé par un `fetch` remplacé : ces tests décrivent le
 * contrat de transport (authentification, pagination, reprise) sans dépendre d'un site.
 * Le scénario complet contre le vrai simulateur vit dans `scripts/test-shotgrid-e2e.mjs`.
 */

const creds = {
  baseUrl: 'https://studio.shotgrid.autodesk.com',
  authMode: 'script' as const,
  scriptName: 'review_sync',
  scriptKey: 'secret',
};

const authOk = () =>
  new Response(JSON.stringify({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function record(id: number, attributes: Record<string, unknown> = {}) {
  return { id, type: 'Shot', attributes, relationships: {} };
}

describe('flattenRecord', () => {
  it('aplatit la forme JSONAPI en un enregistrement unique', () => {
    const flat = flattenRecord({
      id: 12,
      type: 'Shot',
      attributes: { code: 'SH010', sg_cut_in: 1001 },
      relationships: { project: { data: { type: 'Project', id: 70 } } },
    });
    expect(flat).toMatchObject({
      id: 12,
      type: 'Shot',
      code: 'SH010',
      sg_cut_in: 1001,
      project: { type: 'Project', id: 70 },
    });
  });

  it('accepte un enregistrement déjà plat sans l’abîmer', () => {
    const flat = flattenRecord({ id: 3, type: 'Status', code: 'ip' });
    expect(flat.code).toBe('ip');
  });

  it('tolère une charge vide', () => {
    expect(flattenRecord(null)).toEqual({ id: 0, type: '' });
  });
});

describe('ShotgridClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTokenCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('s’authentifie une fois puis réutilise le jeton', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot', { fields: ['code'] });
    await client.search('Asset', { fields: ['code'] });

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('access_token'));
    expect(authCalls).toHaveLength(1);
    // Les identifiants de script passent par le flot « client_credentials ».
    expect(String(authCalls[0]![1].body)).toContain('grant_type=client_credentials');
  });

  it('signale clairement des identifiants refusés', async () => {
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: "Can't authenticate user" }] }, 401));
    const client = new ShotgridClient(creds);
    await expect(client.search('Shot')).rejects.toBeInstanceOf(ShotgridApiError);
    await expect(client.search('Shot')).rejects.toMatchObject({ status: 401 });
  });

  it('utilise le flot mot de passe pour un compte utilisateur', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient({
      baseUrl: creds.baseUrl,
      authMode: 'user',
      login: 'demo.user',
      password: 'legacy',
    });
    await client.search('Shot');
    const body = String(fetchMock.mock.calls[0]![1].body);
    expect(body).toContain('grant_type=password');
    expect(body).toContain('username=demo.user');
  });

  it('refuse de partir sans identifiants', async () => {
    const client = new ShotgridClient({ baseUrl: creds.baseUrl, authMode: 'script' });
    await expect(client.search('Shot')).rejects.toThrow();
  });

  it('parcourt toutes les pages jusqu’à la dernière incomplète', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    const full = Array.from({ length: 500 }, (_, i) => record(i + 1));
    fetchMock.mockResolvedValueOnce(json({ data: full }));
    fetchMock.mockResolvedValueOnce(json({ data: [record(501)] }));

    const client = new ShotgridClient(creds);
    const out = await client.search('Shot', { fields: ['code'] });
    expect(out).toHaveLength(501);
  });

  it('transmet le filtre de projet tel quel', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot', { filters: [['project', 'is', { type: 'Project', id: 70 }]] });

    const searchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    const body = JSON.parse(String(searchCall![1].body));
    expect(body.filters).toEqual([['project', 'is', { type: 'Project', id: 70 }]]);
  });

  it('retente après une erreur transitoire du site', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'busy' }] }, 503));
    fetchMock.mockResolvedValueOnce(json({ data: [record(1)] }));

    const client = new ShotgridClient(creds);
    const out = await client.search('Shot');
    expect(out).toHaveLength(1);
  });

  it('ne retente pas une requête franchement invalide', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: 'bad field' }] }, 400));
    const client = new ShotgridClient(creds);
    await expect(client.search('Shot')).rejects.toMatchObject({ status: 400 });
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('_search'));
    expect(searchCalls).toHaveLength(1);
  });

  it('rend null pour une entité absente plutôt que de lever', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: 'not found' }] }, 404));
    const client = new ShotgridClient(creds);
    expect(await client.findById('Shot', 999, ['code'])).toBeNull();
    expect(await client.schemaField('Shot', 'sg_inexistant')).toBeNull();
  });

  it('n’envoie pas de Content-Type sur une requête sans corps', async () => {
    // Un site ShotGrid réel répond « Unsupported Content-Type » à un GET portant
    // cet en-tête ; le défaut n'était pas visible contre un serveur permissif.
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: { shotgun_version: '8.60' } }));
    const client = new ShotgridClient(creds);
    await client.serverInfo();

    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1.1/'));
    const headers = call![1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Accept).toBe('application/json');
  });

  it('déclare la forme des filtres dans le Content-Type de la recherche', async () => {
    // ShotGrid refuse `application/json` sur `_search` et exige de savoir si les
    // filtres arrivent en tableau de conditions ou en objet à opérateur logique.
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);

    await client.search('Shot', { filters: [['project', 'is', { type: 'Project', id: 70 }]] });
    const arrayCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    expect((arrayCall![1].headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd+shotgun.api3_array+json',
    );
    expect(JSON.parse(String(arrayCall![1].body)).filters).toEqual([
      ['project', 'is', { type: 'Project', id: 70 }],
    ]);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => json({ data: [] }));
    await client.search('Shot', {
      filters: [['code', 'contains', 'SH']],
      logicalOperator: 'or',
    });
    const hashCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    expect((hashCall![1].headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd+shotgun.api3_hash+json',
    );
    // En forme objet, les conditions sont imbriquées sous l'opérateur.
    expect(JSON.parse(String(hashCall![1].body)).filters).toEqual({
      logical_operator: 'or',
      conditions: [['code', 'contains', 'SH']],
    });
  });

  it('cible la version 1.1 de l’API', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot');
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/v1.1/'))).toBe(true);
  });
});
