// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    mediaObject: { aggregate: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

import { assertProjectQuota, getProjectStorageUsage } from './projectQuota';
import { prisma } from './prisma';

const aggregate = vi.mocked(prisma.mediaObject.aggregate);
const findUnique = vi.mocked(prisma.project.findUnique);

beforeEach(() => vi.clearAllMocks());

describe('projectQuota (38.D)', () => {
  it('getProjectStorageUsage sums the sizes (0n if no media)', async () => {
    aggregate.mockResolvedValue({ _sum: { size: null } } as never);
    expect(await getProjectStorageUsage(1)).toBe(0n);
    aggregate.mockResolvedValue({ _sum: { size: 500n } } as never);
    expect(await getProjectStorageUsage(1)).toBe(500n);
  });

  it('null quota (unlimited): never a refusal, without querying the usage', async () => {
    findUnique.mockResolvedValue({ storageQuota: null } as never);
    await expect(assertProjectQuota(1, 10_000)).resolves.toBeUndefined();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('allows as long as usage + addition ≤ quota', async () => {
    findUnique.mockResolvedValue({ storageQuota: 1000n } as never);
    aggregate.mockResolvedValue({ _sum: { size: 600n } } as never);
    await expect(assertProjectQuota(1, 400)).resolves.toBeUndefined();
  });

  it('refuses with a 403 PROJECT_QUOTA if the overrun occurs', async () => {
    findUnique.mockResolvedValue({ storageQuota: 1000n } as never);
    aggregate.mockResolvedValue({ _sum: { size: 800n } } as never);
    await expect(assertProjectQuota(1, 300)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PROJECT_QUOTA',
    });
  });
});
