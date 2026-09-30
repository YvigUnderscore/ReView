// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { redactUrl } from './httpLogger';

/**
 * Les journaux sont conservés longtemps et lus par plus de monde que la base : un jeton
 * qui y atterrit en clair est un jeton public. Ces cas fixent la frontière entre ce qui
 * doit disparaître (le secret) et ce qui doit rester (le chemin, l'identifiant, le filtre)
 * — un journal entièrement masqué ne sert plus à diagnostiquer.
 */
describe('redactUrl — jetons portés par le chemin', () => {
  it("masque le jeton d'invitation, qui pose un mot de passe et ouvre une session", () => {
    expect(redactUrl('/api/auth/invitation/abc123def456')).toBe('/api/auth/invitation/[Redacted]');
  });

  it('masque le jeton de partage client sans perdre la suite du chemin', () => {
    expect(redactUrl('/api/client/s3cr3t/media/42/url')).toBe('/api/client/[Redacted]/media/42/url');
  });

  it('masque le jeton de désabonnement', () => {
    expect(redactUrl('/api/unsubscribe/7.emailDigest.SIGNATURE')).toBe('/api/unsubscribe/[Redacted]');
  });

  it('masque le jeton du webhook ShotGrid (cas historique, non régressé)', () => {
    expect(redactUrl('/api/shotgrid/webhook/wh-token')).toBe('/api/shotgrid/webhook/[Redacted]');
  });

  it('masque chemin ET query dans la même URL', () => {
    expect(redactUrl('/api/client/s3cr3t?token=jwt.value&projectId=4')).toBe(
      '/api/client/[Redacted]?token=[Redacted]&projectId=4',
    );
  });

  it("n'ancre le motif qu'en tête d'URL (pas de masquage sur un chemin qui l'imite)", () => {
    expect(redactUrl('/api/media/1/api/client/x')).toBe('/api/media/1/api/client/x');
  });

  it("laisse intact l'identifiant numérique d'un lien de partage", () => {
    expect(redactUrl('/api/share/42')).toBe('/api/share/42');
  });
});

describe('redactUrl — secrets portés par la query', () => {
  it('masque ?token= (jeton /metrics, transport de repli Socket.io)', () => {
    expect(redactUrl('/metrics?token=abc')).toBe('/metrics?token=[Redacted]');
  });

  it('masque un nom de paramètre inconnu mais parlant', () => {
    expect(redactUrl('/x?shareAuth=a&access_token=b&apiKey=c&refreshToken=d')).toBe(
      '/x?shareAuth=[Redacted]&access_token=[Redacted]&apiKey=[Redacted]&refreshToken=[Redacted]',
    );
  });

  it("masque le code et l'état du retour OIDC", () => {
    expect(redactUrl('/api/auth/oidc/callback?code=xyz&state=st')).toBe(
      '/api/auth/oidc/callback?code=[Redacted]&state=[Redacted]',
    );
  });

  it('conserve les paramètres de filtrage, qui font tout l’intérêt du journal', () => {
    expect(redactUrl('/api/media?projectId=4&limit=50&q=plan')).toBe(
      '/api/media?projectId=4&limit=50&q=plan',
    );
  });

  it('masque plusieurs occurrences du même paramètre', () => {
    expect(redactUrl('/x?token=a&token=b')).toBe('/x?token=[Redacted]&token=[Redacted]');
  });

  it('supporte une query dégénérée sans planter', () => {
    expect(redactUrl('/x?')).toBe('/x?');
    expect(redactUrl('/x?flag')).toBe('/x?flag');
    expect(redactUrl('/x?to%ZZken=a')).toBe('/x?to%ZZken=a');
  });
});
