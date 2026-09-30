// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    userSession: { findMany: vi.fn(), updateMany: vi.fn() },
    apiToken: { updateMany: vi.fn() },
  },
}));

import { revokeAllCredentials } from './sessions';
import { prisma } from './prisma';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
  vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 1 });
});

/**
 * Une session n'est pas le seul identifiant du compte : un token d'API `rvk_` authentifie
 * tout aussi bien, par une table séparée. Ne révoquer que les sessions laissait survivre le
 * jeton qu'un attaquant s'était créé — la reprise en main du compte était illusoire.
 */
describe('revokeAllCredentials', () => {
  it('révoque AUSSI les tokens d’API, pas seulement les sessions', async () => {
    await revokeAllCredentials(42);
    expect(prisma.userSession.updateMany).toHaveBeenCalled();
    expect(prisma.apiToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42, revokedAt: null } }),
    );
  });

  it('épargne la session courante mais révoque les tokens quand même', async () => {
    await revokeAllCredentials(42, 'session-courante');
    const where = vi.mocked(prisma.userSession.updateMany).mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ userId: 42, id: { not: 'session-courante' } });
    expect(prisma.apiToken.updateMany).toHaveBeenCalled();
  });
});
