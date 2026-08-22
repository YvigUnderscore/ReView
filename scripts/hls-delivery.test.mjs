// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants de la diffusion HLS (vague 2 — servir la vidéo sans traverser Node).
 *
 * Le chemin de la vidéo traverse trois fichiers qu'aucun compilateur ne relit ensemble : la
 * route Express, le service qui réécrit les manifestes, et la configuration nginx qui sert
 * les segments. Une régression y est invisible jusqu'au jour où une salle de dailies fait
 * tomber l'API. Les contrôles ci-dessous verrouillent ce qui a été corrigé, et rien de plus.
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
      // Une playlist réécrite pèse ~130 ko de texte très répétitif (une URL présignée par
      // segment) : sans gzip, elle coûte plus cher que les segments qu'elle annonce.
      expect(conf).toContain('application/vnd.apple.mpegurl');
      // Les segments sont du binaire déjà compressé.
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
    // Vingt spectateurs qui démarrent ensemble = une seule lecture au stockage.
    expect(block).toContain('proxy_cache_lock on;');
    // La signature fait partie de la clé : un chemin deviné ne touche aucune entrée.
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
