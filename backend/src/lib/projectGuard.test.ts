// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { project: { findFirst: vi.fn() } },
}));

import { assertProjectWritable } from './projectGuard';
import { prisma } from './prisma';
import { AppError } from './errors';

const findFirst = vi.mocked(prisma.project.findFirst);

beforeEach(() => vi.clearAllMocks());

describe('projectGuard.assertProjectWritable — verrou d’archivage (38.B)', () => {
  it('laisse passer un projet ACTIVE', async () => {
    findFirst.mockResolvedValue({ status: 'ACTIVE' } as never);
    await expect(assertProjectWritable(1)).resolves.toBeUndefined();
  });

  it('refuse un projet ARCHIVED avec un 403 PROJECT_ARCHIVED', async () => {
    findFirst.mockResolvedValue({ status: 'ARCHIVED' } as never);
    try {
      await assertProjectWritable(1);
      expect.fail('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(403);
      expect((e as AppError).code).toBe('PROJECT_ARCHIVED');
    }
  });

  it('404 si le projet est introuvable (ou supprimé)', async () => {
    findFirst.mockResolvedValue(null as never);
    await expect(assertProjectWritable(999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
