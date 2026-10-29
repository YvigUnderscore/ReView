// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { describeMounts } from '../../lib/openapiRoutes';
import { V1_BASE_PATH, V1_MOUNTS } from './index';

/**
 * URL plan of API v1, read the way the OpenAPI generator reads it.
 *
 * The mount table feeds Express AND the documentation: this test takes it at its word, so an
 * endpoint added without a scope, or forgotten in the table, shows up here rather than in production.
 */
const routes = describeMounts(V1_BASE_PATH, V1_MOUNTS);
const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path);

/** Discovery: the index and the bearer's identity have no domain to scope. */
const SCOPELESS = new Set(['/api/v1', '/api/v1/me']);

describe('API v1 URL plan', () => {
  it('publishes the read paths expected by an artist workstation', () => {
    expect(find('get', '/api/v1/media/{id}/url')?.scope).toBe('media:read');
    expect(find('get', '/api/v1/media/{id}')?.scope).toBe('media:read');
    expect(find('get', '/api/v1/tasks/{id}/versions/latest')?.scope).toBe('versions:read');
    expect(find('get', '/api/v1/latest')?.scope).toBe('versions:read');
  });

  /**
   * Gaps closed by the API round: what an integrator could not reach. In particular the `statusId` of
   * `POST /versions/{id}/decision` was discoverable nowhere, so the route that returns it matters as
   * much as the one that consumes it.
   */
  it('publishes what until then lived only on the web API', () => {
    expect(find('get', '/api/v1/versions/{id}/reviewers')?.scope).toBe('versions:read');
    expect(find('put', '/api/v1/versions/{id}/reviewers')?.scope).toBe('versions:write');
    expect(find('patch', '/api/v1/versions/{id}/reviewers/{userId}')?.scope).toBe('versions:write');
    expect(find('get', '/api/v1/review-statuses')?.scope).toBe('versions:read');
    expect(find('get', '/api/v1/versions/{id}/decisions')?.scope).toBe('versions:read');
    expect(find('get', '/api/v1/projects/{ref}/settings')?.scope).toBe('projects:read');
    expect(find('get', '/api/v1/projects/{ref}/episodes')?.scope).toBe('episodes:read');
    expect(find('get', '/api/v1/episodes/{id}')?.scope).toBe('episodes:read');
    expect(find('get', '/api/v1/shots/{id}/note')?.scope).toBe('shots:read');
    expect(find('put', '/api/v1/shots/{id}/note')?.scope).toBe('shots:write');
    expect(find('get', '/api/v1/assets/{id}/assignees')?.scope).toBe('assets:read');
    expect(find('put', '/api/v1/sequences/{id}/assignees')?.scope).toBe('sequences:write');
    // An episode is read under its own domain and written under the sequence's: declaring
    // `episodes:write` without a route requiring it would put a loose scope back in the catalogue.
    expect(find('put', '/api/v1/episodes/{id}/note')?.scope).toBe('sequences:write');
  });

  it('did not break existing write paths', () => {
    expect(find('post', '/api/v1/publish')?.scope).toBe('versions:write');
    expect(find('post', '/api/v1/publish/{id}/complete')?.scope).toBe('versions:write');
    expect(find('get', '/api/v1/resolve')?.scope).toBe('projects:read');
  });

  // "/tasks/:id/versions/latest" must remain distinct from "/tasks/:id/versions": two routes, two
  // responses. A duplicate would indicate a mount that masks another.
  it('never declares the same method + path pair twice', () => {
    const seen = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('requires a scope on every route that touches data', () => {
    const naked = routes.filter((r) => !r.scope && !SCOPELESS.has(r.path));
    expect(naked.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
});
