// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { httpError, mockApi, noContent, type ApiMock } from './apiMock';

/**
 * The API double is tooling, but it carries real decisions: which route
 * answers when two patterns match, what happens to an uncovered request, and what
 * it passes on to the route. A double that fails silently makes the screen tests fail
 * for the wrong reason, which is the worst kind of feedback.
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
  it('answers an exact route and serves JSON', async () => {
    install({ 'GET /api/projects': { items: [{ id: 1 }] } });

    const res = await get('/api/projects');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 1 }] });
  });

  it('distinguishes methods: a POST does not fall on the GET route', async () => {
    install({ 'GET /api/projects': { items: [] } });

    const res = await fetch('/api/projects', { method: 'POST', body: '{}' });

    expect(res.status).toBe(501);
  });

  it('names the request that no route covers, instead of staying silent', async () => {
    const mock = install({});

    const res = await get('/api/inconnu?x=1');

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Unhandled request: GET /api/inconnu?x=1' });
    expect(mock.unhandled).toEqual(['GET /api/inconnu?x=1']);
  });

  it('lets a local resource through, which is not an API call', async () => {
    const mock = install({});

    const res = await fetch('data:application/wasm;base64,AGFzbQ==');

    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0, 0x61, 0x73, 0x6d]));
    expect(mock.calls).toEqual([]);
  });

  it('extracts the named segments of the pattern', async () => {
    install({ 'GET /api/media/:id/comments': ({ params }) => ({ id: params.id }) });

    expect(await (await get('/api/media/42/comments')).json()).toEqual({ id: '42' });
  });

  it('does not let a pattern spill over onto a longer path', async () => {
    install({ 'GET /api/projects/:id': { project: {} } });

    expect((await get('/api/projects/3/settings')).status).toBe(501);
  });

  it('lets the route requiring a query string win over the one that does not require one', async () => {
    install({
      'GET /api/projects': { archived: false },
      'GET /api/projects?archived=1': { archived: true },
    });

    expect(await (await get('/api/projects?archived=1')).json()).toEqual({ archived: true });
    expect(await (await get('/api/projects')).json()).toEqual({ archived: false });
    // Another query string falls back to the generic route: that is the pagination.
    expect(await (await get('/api/projects?page=2')).json()).toEqual({ archived: false });
  });

  it('passes the JSON body to the route and records the call', async () => {
    const mock = install({ 'PATCH /api/tasks/:id': { ok: true } });

    await fetch('/api/tasks/7', { method: 'PATCH', body: JSON.stringify({ status: 'TODO' }) });

    const [call] = mock.called('PATCH /api/tasks/:id');
    expect(call.path).toBe('/api/tasks/7');
    expect(call.body).toEqual({ status: 'TODO' });
    expect(call.params).toEqual({ id: '7' });
  });

  it('returns the status and message of an explicit error', async () => {
    install({ 'GET /api/secret': httpError(403, 'Forbidden') });

    const res = await get('/api/secret');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('can respond without a body', async () => {
    install({ 'DELETE /api/projects/:id': noContent() });

    expect((await fetch('/api/projects/3', { method: 'DELETE' })).status).toBe(204);
  });

  it('lets a route set afterwards replace the previous one', async () => {
    const mock = install({ 'GET /api/me': { role: 'ARTIST' } });
    mock.on('GET /api/me', { role: 'ADMIN' });

    expect(await (await get('/api/me')).json()).toEqual({ role: 'ADMIN' });
  });

  it('gives `fetch` back to the environment when restored', async () => {
    const before = globalThis.fetch;
    const mock = mockApi({ 'GET /api/x': {} });
    expect(globalThis.fetch).not.toBe(before);
    mock.restore();
    expect(globalThis.fetch).toBe(before);
  });
});
