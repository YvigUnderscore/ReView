// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    shareLink: { updateMany: vi.fn() },
  },
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/userCache', () => ({ invalidateAuthUser: vi.fn() }));
vi.mock('../lib/sessions', () => ({ revokeAllCredentials: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./InvitationService', () => ({ assertCanInvite: vi.fn(), sendInvitation: vi.fn() }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));
vi.mock('../lib/userView', () => ({ toPublicUser: (u: unknown) => Promise.resolve(u) }));

import { assertNotLastAdmin, changeRole, deleteUser, setDisabled, updateUser } from './UserService';
import { logAudit } from './AuditService';
import { revokeAllCredentials } from '../lib/sessions';
import { Role } from '@prisma/client';

/** The targeted account, as read by `updateUser` and `assertNotLastAdmin`. */
const target = (over: Partial<{ role: Role; isService: boolean; disabledAt: Date | null }> = {}) =>
  db.user.findUnique.mockResolvedValue({
    role: Role.ADMIN,
    isService: false,
    disabledAt: null,
    ...over,
  });

/** The `where` of the count of remaining administrators. */
const countWhere = () => (db.user.count.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

/** The `data` actually written by the first `user.update`. */
const updateData = () => (db.user.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findFirst.mockResolvedValue(null);
  db.user.update.mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve({ id: 1, email: 'a@b.c', ...(data as object) }),
  );
  db.shareLink.updateMany.mockResolvedValue({ count: 0 });
  target();
});

/**
 * Without this guard, the sole administrator could demote themselves, deactivate themselves or be deleted: the studio
 * stayed up but nobody could create an account or touch the settings, and `setup` refuses to run again once a studio
 * exists. The only recourse was a SQL UPDATE on the database.
 */
describe('assertNotLastAdmin', () => {
  it('lets it through as long as another active administrator remains', async () => {
    db.user.count.mockResolvedValue(1);
    await expect(assertNotLastAdmin(1)).resolves.toBeUndefined();
  });

  it('refuses when no other remains (400 LAST_ADMIN)', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(assertNotLastAdmin(1)).rejects.toMatchObject({ statusCode: 400, code: 'LAST_ADMIN' });
  });

  it('counts only usable administrators: neither service, nor deactivated, nor oneself', async () => {
    db.user.count.mockResolvedValue(1);
    await assertNotLastAdmin(1);
    expect(countWhere()).toEqual({
      id: { not: 1 },
      role: Role.ADMIN,
      isService: false,
      disabledAt: null,
    });
  });

  it('does not apply to an account that is not an administrator', async () => {
    target({ role: Role.ARTIST });
    await expect(assertNotLastAdmin(1)).resolves.toBeUndefined();
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('applies neither to a service account nor to an already deactivated administrator', async () => {
    target({ isService: true });
    await assertNotLastAdmin(1);
    target({ disabledAt: new Date() });
    await assertNotLastAdmin(1);
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it("stays silent on a nonexistent account (the 404 is the caller's job)", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(assertNotLastAdmin(404)).resolves.toBeUndefined();
  });
});

describe('changeRole: last administrator', () => {
  it('refuses to demote the last administrator', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(changeRole(1, 1, Role.ARTIST)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('accepts the demotion as soon as another administrator remains', async () => {
    db.user.count.mockResolvedValue(1);
    await changeRole(1, 2, Role.ARTIST);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 }, data: { role: Role.ARTIST } }),
    );
  });

  it('promoting to ADMIN counts for nothing', async () => {
    await changeRole(1, 2, Role.ADMIN);
    expect(db.user.count).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalled();
  });
});

describe('updateUser: last administrator and deactivation', () => {
  it('refuses to demote the last administrator', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(updateUser(1, 1, { role: Role.SUPERVISOR })).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last administrator', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(updateUser(1, 1, { disabled: true })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('deactivates: date set, credentials revoked, audit named USER_DISABLE', async () => {
    db.user.count.mockResolvedValue(1);
    await updateUser(1, 2, { disabled: true });
    expect(updateData().disabledAt).toBeInstanceOf(Date);
    expect(revokeAllCredentials).toHaveBeenCalledWith(2);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DISABLE' }));
  });

  it('reactivates: the date falls back to null, audit named USER_ENABLE', async () => {
    target({ disabledAt: new Date('2026-01-01') });
    await updateUser(1, 2, { disabled: false });
    expect(updateData()).toEqual({ disabledAt: null });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ENABLE' }));
    // Reactivating cuts nothing: the tokens were already revoked at deactivation.
    expect(revokeAllCredentials).not.toHaveBeenCalled();
  });

  it('deactivating again does not renew the date: it is the departure date', async () => {
    const departure = new Date('2026-01-01');
    target({ disabledAt: departure, role: Role.ARTIST });
    await updateUser(1, 2, { disabled: true });
    expect(updateData()).toEqual({ disabledAt: departure });
  });

  it('an ordinary edit keeps the USER_UPDATE action', async () => {
    target({ role: Role.ARTIST });
    await updateUser(1, 2, { name: 'Ana' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_UPDATE' }));
  });
});

describe('setDisabled / deleteUser: default path and explicit gesture', () => {
  it('setDisabled writes the date without deleting anything', async () => {
    target({ role: Role.ARTIST });
    await setDisabled(1, 2, true);
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(updateData().disabledAt).toBeInstanceOf(Date);
  });

  it('setDisabled refuses to deactivate oneself', async () => {
    await expect(setDisabled(1, 1, true)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('deleteUser refuses to delete the last administrator', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(deleteUser(1, 2)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('deleteUser refuses self-deletion before any other check', async () => {
    await expect(deleteUser(1, 1)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('deleteUser revokes the shares opened by the person, then deletes', async () => {
    target({ role: Role.ARTIST });
    db.shareLink.updateMany.mockResolvedValue({ count: 3 });
    await deleteUser(1, 2);
    expect(db.shareLink.updateMany).toHaveBeenCalledWith({
      where: { createdById: 2, revoked: false },
      data: { revoked: true },
    });
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_DELETE', metadata: { revokedShareLinks: 3 } }),
    );
  });
});
