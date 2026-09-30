// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { describeMounts } from '../../lib/openapiRoutes';
import { V1_BASE_PATH, V1_MOUNTS } from './index';

/**
 * Plan d'URL de l'API v1, lu comme le lit le générateur OpenAPI.
 *
 * La table de montage sert à Express ET à la documentation : ce test la prend au mot, donc
 * un endpoint ajouté sans scope — ou oublié dans la table — se voit ici, pas en production.
 */
const routes = describeMounts(V1_BASE_PATH, V1_MOUNTS);
const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path);

/** Découverte : l'index et l'identité du porteur n'ont pas de domaine à cantonner. */
const SCOPELESS = new Set(['/api/v1', '/api/v1/me']);

describe('plan d’URL de l’API v1', () => {
  it('publie les chemins de lecture attendus par un poste d’artiste', () => {
    expect(find('get', '/api/v1/media/{id}/url')?.scope).toBe('media:read');
    expect(find('get', '/api/v1/media/{id}')?.scope).toBe('media:read');
    expect(find('get', '/api/v1/tasks/{id}/versions/latest')?.scope).toBe('versions:read');
    expect(find('get', '/api/v1/latest')?.scope).toBe('versions:read');
  });

  /**
   * Les manques soldés par le tour d'API : ce qu'un intégrateur ne pouvait pas atteindre.
   * Le `statusId` de `POST /versions/{id}/decision` n'était notamment découvrable nulle
   * part — la route qui le rend est donc aussi importante que celle qui le consomme.
   */
  it('publie ce qui vivait jusque-là sur la seule API web', () => {
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
    // Un épisode se lit sous son domaine et s'écrit sous celui de la séquence : déclarer
    // `episodes:write` sans route qui l'exige remettrait au catalogue un scope creux.
    expect(find('put', '/api/v1/episodes/{id}/note')?.scope).toBe('sequences:write');
  });

  it('n’a pas cassé les chemins d’écriture existants', () => {
    expect(find('post', '/api/v1/publish')?.scope).toBe('versions:write');
    expect(find('post', '/api/v1/publish/{id}/complete')?.scope).toBe('versions:write');
    expect(find('get', '/api/v1/resolve')?.scope).toBe('projects:read');
  });

  // « /tasks/:id/versions/latest » doit rester distinct de « /tasks/:id/versions » : deux
  // routes, deux réponses. Un doublon signerait un montage qui en masque un autre.
  it('ne déclare jamais deux fois le même couple méthode + chemin', () => {
    const seen = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('exige un scope sur toute route qui touche à des données', () => {
    const naked = routes.filter((r) => !r.scope && !SCOPELESS.has(r.path));
    expect(naked.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
});
