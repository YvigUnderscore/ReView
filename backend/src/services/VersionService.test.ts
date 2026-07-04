import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { version: { count: vi.fn(), create: vi.fn() } },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteVersion: vi.fn(),
  restoreVersion: vi.fn(),
  purgeVersion: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { create } from './VersionService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';
import { Role } from '@prisma/client';

const count = vi.mocked(prisma.version.count);
const createVersion = vi.mocked(prisma.version.create);
const user = { id: 3, role: Role.ARTIST };

describe('VersionService.create — auto-nommage des versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVersion.mockImplementation(({ data }: never) => Promise.resolve({ id: 1, ...data }) as never);
  });

  it('nomme V01 quand aucune version n’existe encore', async () => {
    count.mockResolvedValue(0 as never);
    await create(user, 7, { taskId: 42 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V01', taskId: 42, authorId: 3 }) }),
    );
    expect(emitToProject).toHaveBeenCalledWith(
      7,
      'version:update',
      expect.objectContaining({ projectId: 7, taskId: 42 }),
    );
  });

  it('incrémente avec padding sur 2 chiffres (count 9 → V10)', async () => {
    count.mockResolvedValue(9 as never);
    await create(user, 7, { assetId: 5 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V10', assetId: 5 }) }),
    );
  });

  it('respecte un nom explicite sans compter', async () => {
    await create(user, 7, { taskId: 1, name: 'Final' });
    expect(count).not.toHaveBeenCalled();
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Final' }) }),
    );
  });
});
