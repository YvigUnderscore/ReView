// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { routeLabel, __testing } from './metrics';

/**
 * Chaque valeur distincte du label `route` crée une série persistante dans le registre
 * Prometheus. `httpMetrics` est monté avant le rate limiter global : sans borne, marteler
 * des chemins aléatoires fait grossir le registre sans fin.
 */
beforeEach(() => __testing.seenRoutes.clear());

describe('routeLabel', () => {
  it('conserve les vraies routes, ids et tokens agrégés', () => {
    expect(routeLabel('/api/media/241/hls/master.m3u8', 200)).toBe('/api/media/:id/hls/master.m3u8');
    expect(routeLabel('/api/client/2581683afc4d61c8a918a187885e21ac', 200)).toBe('/api/client/:token');
  });

  // Une vraie route ne renvoie pas 404 : c'est la signature du balayage de chemins.
  it('agrège les 404 sans jamais enrichir le catalogue', () => {
    for (let i = 0; i < 5000; i++) expect(routeLabel(`/inexistant-${i}`, 404)).toBe('/other');
    expect(__testing.seenRoutes.size).toBe(0);
  });

  // Un 404 n'est pas le seul statut qu'un balayage produit : `/api/media/abc` passe la
  // validation Zod à l'échec et répond 400. Seule une réponse ABOUTIE enrichit le catalogue.
  it('n’enrichit le catalogue sur aucun statut d’erreur', () => {
    for (const status of [400, 401, 403, 404, 422, 500]) {
      expect(routeLabel(`/api/media/poison-${status}`, status)).toBe('/other');
    }
    expect(__testing.seenRoutes.size).toBe(0);
  });

  // Une route déjà connue garde son étiquette même en erreur : sans cela, on perdrait de vue
  // le taux d'échec des vraies routes.
  it('conserve l’étiquette d’une route connue lorsqu’elle échoue', () => {
    expect(routeLabel('/api/projects', 200)).toBe('/api/projects');
    expect(routeLabel('/api/projects', 403)).toBe('/api/projects');
    expect(routeLabel('/api/projects', 500)).toBe('/api/projects');
  });

  it('plafonne le nombre de routes distinctes', () => {
    for (let i = 0; i < __testing.MAX_ROUTE_LABELS + 500; i++) routeLabel(`/api/r${i}`, 200);
    expect(__testing.seenRoutes.size).toBeLessThanOrEqual(__testing.MAX_ROUTE_LABELS);
    expect(routeLabel('/api/encore-une-autre', 200)).toBe('/other');
  });

  it('continue de servir les routes déjà connues une fois le plafond atteint', () => {
    expect(routeLabel('/api/dashboard', 200)).toBe('/api/dashboard');
    for (let i = 0; i < __testing.MAX_ROUTE_LABELS + 10; i++) routeLabel(`/api/r${i}`, 200);
    expect(routeLabel('/api/dashboard', 200)).toBe('/api/dashboard');
  });
});
