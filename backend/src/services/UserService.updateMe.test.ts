// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));

import { updateMe } from './UserService';
import { prisma } from '../lib/prisma';

const findFirst = vi.mocked(prisma.user.findFirst);
const update = vi.mocked(prisma.user.update);

describe('UserService.updateMe: enriched profile (42.B, issue #89)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    update.mockResolvedValue({ id: 1, email: 'a@b.c', avatarKey: null } as never);
  });

  it('persists role / bio / phone', async () => {
    await updateMe(1, { jobTitle: 'Compositing', bio: 'Bonjour', phone: '+33 6' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { jobTitle: 'Compositing', bio: 'Bonjour', phone: '+33 6' },
      }),
    );
  });

  it('writes only the supplied fields', async () => {
    await updateMe(1, { firstName: 'Ana' });
    expect(update.mock.calls[0]![0].data).toEqual({ firstName: 'Ana' });
  });
});
