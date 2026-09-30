// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { describeRouter } from '../../lib/openapiRoutes';
import publishRoutes from './publish.routes';

/**
 * Contrat d'entrée de `POST /api/v1/publish` pour le champ `usd`. Le schéma est lu sur le
 * routeur lui-même (comme le fait le générateur OpenAPI) : c'est bien la validation servie
 * en production qui est éprouvée, pas une copie.
 */
const body = describeRouter(publishRoutes, '/api/v1/publish').find(
  (r) => r.method === 'post' && r.path === '/api/v1/publish',
)!.schemas.body!;

const base = { path: 'PROJ/SQ010/SH0100/anim', filename: 'SH0100_set_v001.usd' };

describe('POST /api/v1/publish — champ usd', () => {
  it('reste facultatif : un client qui l’ignore publie comme avant', () => {
    const parsed = body.parse(base) as { usd?: unknown };
    expect(parsed.usd).toBeUndefined();
  });

  it('accepte une sélection de variantes et complète le purpose par défaut', () => {
    const parsed = body.parse({
      ...base,
      usd: { variants: { '/World/Set': { modelingVariant: 'hero' } } },
    }) as { usd: { variants: unknown; purpose: string } };
    expect(parsed.usd).toEqual({
      variants: { '/World/Set': { modelingVariant: 'hero' } },
      purpose: 'render',
    });
  });

  it('refuse un purpose hors de ceux que le convertisseur sait rendre', () => {
    expect(body.safeParse({ ...base, usd: { purpose: 'beauty' } }).success).toBe(false);
  });

  it('refuse une sélection trop volumineuse', () => {
    const variants = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`/World/Asset${i}`, { modelingVariant: 'hero' }]),
    );
    expect(body.safeParse({ ...base, usd: { variants } }).success).toBe(false);
  });
});
