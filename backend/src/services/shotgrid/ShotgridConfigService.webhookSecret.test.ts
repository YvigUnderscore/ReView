// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The webhook signing secret: what ReView shows must be what ReView verifies.
 *
 * The connection was born with a random secret that no surface exposed: neither the API view nor the screen. Nobody could therefore
 * set it in the site's webhook, ShotGrid signed with something else, and every delivery came back 404. These tests guard the path that
 * makes the integration configurable: clear-text reading, rotation, and the fact that the value returned validly signs a ShotGrid delivery.
 *
 * Encryption is **not** mocked: the real `encryptSecret`/`decryptSecret` run here. A test that mocked the crypto would only check its own mock.
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

describe('webhook secret', () => {
  it('returns the stored secret in clear', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(encryptSecret('le-secret-du-site')));

    await expect(revealWebhookSecret(7)).resolves.toBe('le-secret-du-site');
  });

  it('returns null when the connection requires no signature', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(null));

    await expect(revealWebhookSecret(7)).resolves.toBeNull();
  });

    /**
     * The missing invariant: the value given to the administrator is exactly the one the webhook route will read back. If rotation stored
     * something other than what it returns, we would have recreated the original failure, only more discreetly.
     */
  it('stores exactly the secret it returns', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(encryptSecret('ancien')));

    const secret = await rotateWebhookSecret(7);
    const stored = db.shotgridConnection.update.mock.calls[0]![0].data.webhookSecret as string;

    expect(secret).not.toBe('ancien');
    expect(secret.length).toBeGreaterThan(20);
        // Encrypted in the database, never in clear.
    expect(stored).not.toContain(secret);
    expect(webhookSecretOf(connection(stored))).toBe(secret);
  });

  it('never returns the same secret twice', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(connection(null));

    expect(await rotateWebhookSecret(7)).not.toBe(await rotateWebhookSecret(7));
  });

    /**
     * End to end: the displayed value signs a delivery the way ShotGrid does (HMAC-SHA1 of the body bytes), and the signature obtained
     * is the one the route recomputes from the decrypted secret.
     */
  it('validates a ShotGrid signature computed with the displayed value', async () => {
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
