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

import { setAvatar } from './UserService';
import { prisma } from '../lib/prisma';

const update = vi.mocked(prisma.user.update);

/**
 * A1-04 / A2-06: the avatar key was compared to a PREFIX without a delimiter
 * (`key.startsWith('avatars/' + userId)`). But `StorageService.avatarKey` produces
 * `avatars/<id><ext>`, with no slash after the identifier: `'avatars/91.png'` therefore starts with
 * `'avatars/9'`, and account 9 served the photo of account 91.
 *
 * The direct impact is low (an avatar is visible to all authenticated accounts), but it is the check written correctly
 * elsewhere (`DepartmentService.setImage`, `EntityThumbnailService.set`) that prevents presigning an arbitrary object
 * of the bucket. Leaving it wrong here leaves the bad copy to be duplicated: the route had been hardened, yet the service,
 * the only one writing to the database, remained the real source.
 */
describe('UserService.setAvatar: the key must designate EXACTLY its own avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({ id: 9, email: 'a@b.c', avatarKey: null } as never);
  });

  it('accepts the key produced for this account, in the three formats served', async () => {
    for (const key of ['avatars/9.png', 'avatars/9.jpg', 'avatars/9.webp']) {
      await setAvatar(9, key);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { avatarKey: key } }));
    }
  });

  it('accepts removing the photo', async () => {
    await setAvatar(9, null);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { avatarKey: null } }));
  });

  it('refuses the key of an account whose identifier starts with its own', async () => {
    // The exact edge case: 9 -> 91, 1 -> 12, 1 -> 100.
    await expect(setAvatar(9, 'avatars/91.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(1, 'avatars/12.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(1, 'avatars/100.webp')).rejects.toMatchObject({ code: 'BAD_KEY' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a key outside the avatars folder, or without a known extension', async () => {
    // `avatars/` is only a prefix of the bucket: nothing will prevent tomorrow another key from sharing it.
    // The guard therefore names the whole shape, not its beginning.
    await expect(setAvatar(9, 'derived/9/source.mp4')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9/../12.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9.exe')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, '')).rejects.toMatchObject({ code: 'BAD_KEY' });
    expect(update).not.toHaveBeenCalled();
  });
});
