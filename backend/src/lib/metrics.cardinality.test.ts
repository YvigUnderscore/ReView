// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { routeLabel, __testing } from './metrics';

/**
 * Every distinct value of the `route` label creates a persistent series in the Prometheus registry.
 * `httpMetrics` is mounted before the global rate limiter: unbounded, hammering random paths grows the registry forever.
 */
beforeEach(() => __testing.seenRoutes.clear());

describe('routeLabel', () => {
  it('keeps real routes, aggregating ids and tokens', () => {
    expect(routeLabel('/api/media/241/hls/master.m3u8', 200)).toBe('/api/media/:id/hls/master.m3u8');
    expect(routeLabel('/api/client/2581683afc4d61c8a918a187885e21ac', 200)).toBe('/api/client/:token');
  });

  // A real route does not return 404: that is the signature of a path sweep.
  it('aggregates 404s without ever enriching the catalogue', () => {
    for (let i = 0; i < 5000; i++) expect(routeLabel(`/inexistant-${i}`, 404)).toBe('/other');
    expect(__testing.seenRoutes.size).toBe(0);
  });

  // A 404 is not the only status a sweep produces: `/api/media/abc` fails Zod validation and answers 400. Only a
  // SUCCESSFUL response enriches the catalogue.
  it('does not enrich the catalogue on any error status', () => {
    for (const status of [400, 401, 403, 404, 422, 500]) {
      expect(routeLabel(`/api/media/poison-${status}`, status)).toBe('/other');
    }
    expect(__testing.seenRoutes.size).toBe(0);
  });

  // A known route keeps its label even on error: otherwise we would lose sight of the failure rate of real routes.
  it('keeps the label of a known route when it fails', () => {
    expect(routeLabel('/api/projects', 200)).toBe('/api/projects');
    expect(routeLabel('/api/projects', 403)).toBe('/api/projects');
    expect(routeLabel('/api/projects', 500)).toBe('/api/projects');
  });

  it('caps the number of distinct routes', () => {
    for (let i = 0; i < __testing.MAX_ROUTE_LABELS + 500; i++) routeLabel(`/api/r${i}`, 200);
    expect(__testing.seenRoutes.size).toBeLessThanOrEqual(__testing.MAX_ROUTE_LABELS);
    expect(routeLabel('/api/encore-une-autre', 200)).toBe('/other');
  });

  it('keeps serving the already known routes once the cap is reached', () => {
    expect(routeLabel('/api/dashboard', 200)).toBe('/api/dashboard');
    for (let i = 0; i < __testing.MAX_ROUTE_LABELS + 10; i++) routeLabel(`/api/r${i}`, 200);
    expect(routeLabel('/api/dashboard', 200)).toBe('/api/dashboard');
  });
});
