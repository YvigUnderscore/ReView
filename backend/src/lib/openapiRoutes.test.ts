// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { Router } from 'express';
import { z } from 'zod';
import { describeRouter, describeMounts, joinPaths, toOpenApiPath } from './openapiRoutes';
import { validate } from '../middleware/validate';
import { requireScope } from '../middleware/scope';

const noop = () => undefined;

describe('joinPaths', () => {
  it('assemble sans doubler ni laisser traîner de barre', () => {
    expect(joinPaths('/api/v1', '/projects')).toBe('/api/v1/projects');
    expect(joinPaths('/api/v1/', '/', '/shots/')).toBe('/api/v1/shots');
    expect(joinPaths('/api/v1', '')).toBe('/api/v1');
    expect(joinPaths('', '/')).toBe('/');
  });
});

describe('toOpenApiPath', () => {
  it('convertit les paramètres Express en gabarits OpenAPI', () => {
    expect(toOpenApiPath('/shots/:id')).toBe('/shots/{id}');
    expect(toOpenApiPath('/media/:id/comments')).toBe('/media/{id}/comments');
    expect(toOpenApiPath('/projects/:ref/shots')).toBe('/projects/{ref}/shots');
    expect(toOpenApiPath('/health')).toBe('/health');
  });
});

describe('describeRouter', () => {
  it('extrait méthode, chemin, schémas et scope de chaque route', () => {
    const router = Router();
    const params = z.object({ id: z.coerce.number() });
    const body = z.object({ name: z.string() });
    router.post('/:id/tasks', requireScope('tasks:write'), validate({ params, body }), noop);

    const [route, ...rest] = describeRouter(router, '/api/v1/shots');
    expect(rest).toHaveLength(0);
    expect(route).toMatchObject({ method: 'post', path: '/api/v1/shots/{id}/tasks', scope: 'tasks:write' });
    expect(route!.schemas.params).toBe(params);
    expect(route!.schemas.body).toBe(body);
  });

  it('décrit une route sans validation ni scope', () => {
    const router = Router();
    router.get('/', noop);
    expect(describeRouter(router, '/api/v1')).toEqual([
      { method: 'get', path: '/api/v1', schemas: {}, scope: undefined },
    ]);
  });

  it('produit une entrée par méthode déclarée', () => {
    const router = Router();
    router.route('/x').get(noop).delete(noop);
    const methods = describeRouter(router, '/base').map((r) => r.method);
    expect(methods.sort()).toEqual(['delete', 'get']);
  });

  it('ignore les middlewares montés sans route', () => {
    const router = Router();
    router.use(noop);
    expect(describeRouter(router, '/base')).toEqual([]);
  });
});

describe('describeMounts', () => {
  it('applique le préfixe de chaque montage', () => {
    const a = Router();
    a.get('/', noop);
    const b = Router();
    b.get('/:id', noop);

    const routes = describeMounts('/api/v1', [
      { prefix: '/events', router: a },
      { prefix: '', router: b },
    ]);
    expect(routes.map((r) => r.path)).toEqual(['/api/v1/events', '/api/v1/{id}']);
  });
});
