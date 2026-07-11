import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./StorageService', () => ({ storage: {}, StorageService: class {} }));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));

import { getPreferences, updatePreferences } from './UserService';
import { prisma } from '../lib/prisma';

const findUnique = vi.mocked(prisma.user.findUnique);
const update = vi.mocked(prisma.user.update);

describe('UserService — préférences UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({} as never);
  });

  it('renvoie {} quand aucune préférence enregistrée', async () => {
    findUnique.mockResolvedValue({ preferences: null } as never);
    expect(await getPreferences(1)).toEqual({});
  });

  it('merge superficiellement et persiste', async () => {
    findUnique.mockResolvedValue({ preferences: { a: 1, kanbanViews: { '5': [] } } } as never);
    const next = await updatePreferences(1, { b: 'x' });
    expect(next).toEqual({ a: 1, kanbanViews: { '5': [] }, b: 'x' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { preferences: next } }),
    );
  });

  it('supprime une clé passée à null', async () => {
    findUnique.mockResolvedValue({ preferences: { a: 1, b: 2 } } as never);
    expect(await updatePreferences(1, { a: null })).toEqual({ b: 2 });
  });

  it('refuse des préférences trop volumineuses', async () => {
    findUnique.mockResolvedValue({ preferences: {} } as never);
    const big = 'x'.repeat(40_000);
    await expect(updatePreferences(1, { big })).rejects.toMatchObject({
      code: 'PREFERENCES_TOO_LARGE',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejette un utilisateur introuvable', async () => {
    findUnique.mockResolvedValue(null as never);
    await expect(getPreferences(99)).rejects.toThrow();
  });
});
