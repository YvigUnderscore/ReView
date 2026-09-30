// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le secret de signature du webhook : ce que ReView montre doit être ce que ReView vérifie.
 *
 * La connexion naissait avec un secret aléatoire qu'aucune surface n'exposait — ni la vue
 * d'API, ni l'écran. Personne ne pouvait donc le poser dans le webhook du site, ShotGrid
 * signait avec autre chose, et toutes les livraisons repartaient en 404. Ces tests gardent
 * le chemin qui rend l'intégration réglable : lecture en clair, rotation, et le fait que la
 * valeur rendue valide bien une signature ShotGrid.
 *
 * Le chiffrement n'est **pas** doublé : c'est le vrai `encryptSecret`/`decryptSecret` qui
 * tourne ici. Un test qui doublerait la crypto vérifierait sa propre doublure.
 */

const { db } = vi.hoisted(() => ({
  db: { shotgridConnection: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { encryptSecret } from '../../lib/crypto';
import { revealWebhookSecret, rotateWebhookSecret, webhookSecretOf } from './ShotgridConfigService';
import type { ShotgridConnection } from '@prisma/client';

const connection = (webhookSecret: string | null) =>
  ({ id: 1, projectId: 7, webhookSecret, site: {} }) as unknown as ShotgridConnection;

beforeEach(() => {
  vi.clearAllMocks();
  db.shotgridConnection.update.mockResolvedValue({});
});

describe('secret de webhook', () => {
  it('rend en clair le secret enregistré', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(encryptSecret('le-secret-du-site')));

    await expect(revealWebhookSecret(7)).resolves.toBe('le-secret-du-site');
  });

  it('rend null quand la connexion n’exige aucune signature', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(null));

    await expect(revealWebhookSecret(7)).resolves.toBeNull();
  });

  /**
   * L'invariant qui manquait : la valeur donnée à l'administrateur est exactement celle
   * que la route du webhook relira. Si la rotation enregistrait autre chose que ce qu'elle
   * rend, on aurait recréé la panne d'origine — en plus discret.
   */
  it('enregistre exactement le secret qu’elle rend', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(encryptSecret('ancien')));

    const secret = await rotateWebhookSecret(7);
    const stored = db.shotgridConnection.update.mock.calls[0]![0].data.webhookSecret as string;

    expect(secret).not.toBe('ancien');
    expect(secret.length).toBeGreaterThan(20);
    // Chiffré en base, jamais en clair.
    expect(stored).not.toContain(secret);
    expect(webhookSecretOf(connection(stored))).toBe(secret);
  });

  it('ne rend jamais deux fois le même secret', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(null));

    expect(await rotateWebhookSecret(7)).not.toBe(await rotateWebhookSecret(7));
  });

  /**
   * Bout en bout : la valeur affichée signe une livraison à la manière de ShotGrid
   * (HMAC-SHA1 des octets du corps), et la signature obtenue est celle que la route
   * recalcule à partir du secret déchiffré.
   */
  it('valide une signature ShotGrid calculée avec la valeur affichée', async () => {
    const stored = encryptSecret('secret-partage-avec-le-site');
    db.shotgridConnection.findUnique.mockResolvedValue(connection(stored));
    const shown = await revealWebhookSecret(7);

    const body = Buffer.from('{"data":{"event_type":"Test_Connection"}}', 'utf8');
    const siteSignature = createHmac('sha1', shown!).update(body).digest('hex');
    const reviewSignature = createHmac('sha1', webhookSecretOf(connection(stored))!)
      .update(body)
      .digest('hex');

    expect(siteSignature).toBe(reviewSignature);
  });
});
