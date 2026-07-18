import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn() },
    comment: { findUnique: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));

import { createFromComment, taskNameFromComment } from './TaskService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { Role } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.create).mockResolvedValue({
    id: 50,
    name: 'n',
    shotId: 7,
    assetId: null,
  } as never);
});

describe('taskNameFromComment (32.D)', () => {
  it('déshabille le HTML, compacte les espaces et tronque à 80', () => {
    expect(taskNameFromComment('<b>corriger</b>\n  le  reflet')).toBe('corriger le reflet');
    const long = 'x'.repeat(120);
    expect(taskNameFromComment(long)).toHaveLength(80);
    expect(taskNameFromComment(long).endsWith('…')).toBe(true);
  });
  it('fallback pour un commentaire sans texte', () => {
    expect(taskNameFromComment('<img src="x">')).toBe('Retour de review');
  });
});

describe('createFromComment (32.D)', () => {
  it('rattache la tâche au shot de la version et reprend l’assigné', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'corriger le reflet',
      assigneeId: 4,
      media: { version: { assetId: null, task: { shotId: 7, assetId: null } } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'corriger le reflet',
          shotId: 7,
          assetId: null,
          assigneeId: 4,
          sourceCommentId: 9,
        }),
      }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 4, type: 'TASK_ASSIGNED' }));
  });

  it('version d’asset direct : tâche rattachée à l’asset', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'ok',
      assigneeId: null,
      media: { version: { assetId: 12, task: null } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shotId: null, assetId: 12 }) }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('400 si le média n’a ni shot ni asset, 404 si commentaire inconnu', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'x',
      assigneeId: null,
      media: { version: { assetId: null, task: null } },
    } as never);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(null as never);
    await expect(createFromComment(supervisor, 3, 99)).rejects.toMatchObject({ statusCode: 404 });
  });
});
