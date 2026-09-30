// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { httpError, mockApi, noContent, type ApiMock } from './apiMock';

/**
 * Le bouchon d'API est de l'outillage, mais il porte de vraies décisions : quelle route
 * répond quand deux motifs conviennent, ce qu'il advient d'une requête non couverte, ce
 * qu'il transmet à la route. Un bouchon qui se trompe silencieusement fait échouer les
 * tests d'écran pour la mauvaise raison — c'est le pire des retours.
 */

let api: ApiMock | null = null;

const install = (routes: Parameters<typeof mockApi>[0]): ApiMock => {
  api = mockApi(routes);
  return api;
};

afterEach(() => {
  api?.restore();
  api = null;
});

const get = (path: string) => fetch(path);

describe('mockApi', () => {
  it('répond à une route exacte et sert du JSON', async () => {
    install({ 'GET /api/projects': { items: [{ id: 1 }] } });

    const res = await get('/api/projects');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 1 }] });
  });

  it('distingue les méthodes : un POST ne tombe pas sur la route GET', async () => {
    install({ 'GET /api/projects': { items: [] } });

    const res = await fetch('/api/projects', { method: 'POST', body: '{}' });

    expect(res.status).toBe(501);
  });

  it('nomme la requête qu’aucune route ne couvre, au lieu de rester muet', async () => {
    const mock = install({});

    const res = await get('/api/inconnu?x=1');

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Unhandled request: GET /api/inconnu?x=1' });
    expect(mock.unhandled).toEqual(['GET /api/inconnu?x=1']);
  });

  it('extrait les segments nommés du motif', async () => {
    install({ 'GET /api/media/:id/comments': ({ params }) => ({ id: params.id }) });

    expect(await (await get('/api/media/42/comments')).json()).toEqual({ id: '42' });
  });

  it('ne laisse pas un motif déborder sur un chemin plus long', async () => {
    install({ 'GET /api/projects/:id': { project: {} } });

    expect((await get('/api/projects/3/settings')).status).toBe(501);
  });

  it('fait gagner la route qui exige une query-string sur celle qui n’en exige pas', async () => {
    install({
      'GET /api/projects': { archived: false },
      'GET /api/projects?archived=1': { archived: true },
    });

    expect(await (await get('/api/projects?archived=1')).json()).toEqual({ archived: true });
    expect(await (await get('/api/projects')).json()).toEqual({ archived: false });
    // Une autre query-string retombe sur la route générique — c'est la pagination.
    expect(await (await get('/api/projects?page=2')).json()).toEqual({ archived: false });
  });

  it('transmet le corps JSON à la route et enregistre l’appel', async () => {
    const mock = install({ 'PATCH /api/tasks/:id': { ok: true } });

    await fetch('/api/tasks/7', { method: 'PATCH', body: JSON.stringify({ status: 'TODO' }) });

    const [call] = mock.called('PATCH /api/tasks/:id');
    expect(call.path).toBe('/api/tasks/7');
    expect(call.body).toEqual({ status: 'TODO' });
    expect(call.params).toEqual({ id: '7' });
  });

  it('rend le statut et le message d’une erreur explicite', async () => {
    install({ 'GET /api/secret': httpError(403, 'Forbidden') });

    const res = await get('/api/secret');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('sait répondre sans corps', async () => {
    install({ 'DELETE /api/projects/:id': noContent() });

    expect((await fetch('/api/projects/3', { method: 'DELETE' })).status).toBe(204);
  });

  it('laisse une route posée après coup remplacer la précédente', async () => {
    const mock = install({ 'GET /api/me': { role: 'ARTIST' } });
    mock.on('GET /api/me', { role: 'ADMIN' });

    expect(await (await get('/api/me')).json()).toEqual({ role: 'ADMIN' });
  });

  it('rend `fetch` à l’environnement quand on le restaure', async () => {
    const before = globalThis.fetch;
    const mock = mockApi({ 'GET /api/x': {} });
    expect(globalThis.fetch).not.toBe(before);
    mock.restore();
    expect(globalThis.fetch).toBe(before);
  });
});
