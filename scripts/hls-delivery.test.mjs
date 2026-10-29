// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants of HLS delivery (wave 2 — serve the video without going through Node).
 *
 * The path of the video crosses three files that no compiler reads together: the
 * Express route, the service that rewrites the manifests, and the nginx configuration that serves
 * the segments. A regression there is invisible until the day a dailies room brings
 * the API down. The checks below lock down what was fixed, and nothing more.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const prodNginx = read('nginx', 'nginx.conf');
const frontNginx = read('frontend', 'nginx.conf');
const mediaRoutes = read('backend', 'src', 'routes', 'media.routes.ts');
const mediaService = read('backend', 'src', 'services', 'MediaService.ts');

describe('playlists HLS — compression', () => {
  for (const [name, conf] of Object.entries({
    'nginx/nginx.conf': prodNginx,
    'frontend/nginx.conf': frontNginx,
  })) {
    it(`compresse les manifestes, jamais les segments (${name})`, () => {
      // A rewritten playlist weighs ~130 KB of very repetitive text (a presigned URL per
      // segment): without gzip, it costs more than the segments it announces.
      expect(conf).toContain('application/vnd.apple.mpegurl');
      // The segments are already-compressed binary.
      expect(conf).not.toContain('video/mp2t');
    });
  }
});

describe('segments HLS — servis par le stockage, mis en cache par le frontal', () => {
  it('déclare une zone de cache dédiée', () => {
    expect(prodNginx).toMatch(/proxy_cache_path\s+\S+\s+levels=\S+\s+keys_zone=review_hls:/);
  });

  it('les sert depuis une location en expression régulière (elle prime sur /review/)', () => {
    expect(prodNginx).toMatch(/location ~ \^\/review\/derived\/\[0-9\]\+\/hls\//);
  });

  it('active le tampon : sans lui nginx ne remplit jamais le cache', () => {
    const block = /location ~ \^\/review\/derived[\s\S]*?\n {4}\}/.exec(prodNginx)?.[0] ?? '';
    expect(block).toContain('proxy_buffering on;');
    expect(block).toContain('proxy_cache review_hls;');
    // Twenty viewers starting together = a single read from storage.
    expect(block).toContain('proxy_cache_lock on;');
    // The signature is part of the key: a guessed path touches no entry.
    expect(block).toMatch(/proxy_cache_key\s+"\$scheme\$request_method\$host\$request_uri";/);
  });

  it('ne fige un an QUE les réponses réussies (une URL expirée renvoie 403)', () => {
    expect(prodNginx).toMatch(/map \$status \$review_hls_cache_control \{[\s\S]*?default\s+"";/);
    expect(prodNginx).toContain('add_header Cache-Control $review_hls_cache_control always;');
  });

  it("n'expose jamais le jeton de session au stockage, sans casser l'auth S3 par en-tête", () => {
    expect(prodNginx).toMatch(
      /map \$review_presigned \$review_storage_auth \{[\s\S]*?default \$http_authorization;/,
    );
    expect(prodNginx).toContain('proxy_set_header Authorization $review_storage_auth;');
  });
});

describe('API — les manifestes seuls, et plus jamais de cache de 60 s', () => {
  it('la route ne pose plus de politique de cache en dur', () => {
    expect(mediaRoutes).not.toContain('max-age=60');
    expect(mediaRoutes).toContain("res.setHeader('Cache-Control', out.cacheControl)");
  });

  it('un segment servi en repli est immuable, un manifeste ne se cache pas', () => {
    expect(mediaService).toContain("'private, max-age=31536000, immutable'");
    expect(mediaService).toContain("'private, no-store'");
  });

  it("le contrôle d'accès complet reste appelé pour le maître", () => {
    expect(mediaService).toMatch(/if \(isMaster \|\| !verifyMediaPlaybackToken\([\s\S]{0,80}assertHlsRead/);
  });

  it('le journal d’accès média survit à la sortie des segments', () => {
    expect(mediaService).toMatch(/logMediaAccess\(\{ mediaObjectId: id, userId: user\.id/);
  });
});
