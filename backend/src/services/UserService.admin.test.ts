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
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));
vi.mock('../lib/userView', () => ({ toPublicUser: (u: unknown) => Promise.resolve(u) }));

import { assertNotLastAdmin, changeRole, deleteUser, setDisabled, updateUser } from './UserService';
import { logAudit } from './AuditService';
import { revokeAllCredentials } from '../lib/sessions';
import { Role } from '@prisma/client';

/** Le compte visé, tel que le lisent `updateUser` et `assertNotLastAdmin`. */
const target = (over: Partial<{ role: Role; isService: boolean; disabledAt: Date | null }> = {}) =>
  db.user.findUnique.mockResolvedValue({
    role: Role.ADMIN,
    isService: false,
    disabledAt: null,
    ...over,
  });

/** Le `where` du comptage des administrateurs restants. */
const countWhere = () => (db.user.count.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

/** Le `data` réellement écrit par le premier `user.update`. */
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
 * Sans ce garde-fou, l'unique administrateur pouvait se rétrograder, se désactiver ou être
 * supprimé : le studio restait debout mais plus personne ne pouvait créer un compte ni
 * toucher aux réglages, et `setup` refuse de rejouer dès qu'un studio existe. Le seul
 * recours était un UPDATE SQL sur la base.
 */
describe('assertNotLastAdmin', () => {
  it('laisse passer tant qu’un autre administrateur actif subsiste', async () => {
    db.user.count.mockResolvedValue(1);
    await expect(assertNotLastAdmin(1)).resolves.toBeUndefined();
  });

  it('refuse quand il n’en reste aucun autre (400 LAST_ADMIN)', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(assertNotLastAdmin(1)).rejects.toMatchObject({ statusCode: 400, code: 'LAST_ADMIN' });
  });

  it('ne compte que les administrateurs utilisables : ni service, ni désactivé, ni soi-même', async () => {
    db.user.count.mockResolvedValue(1);
    await assertNotLastAdmin(1);
    expect(countWhere()).toEqual({
      id: { not: 1 },
      role: Role.ADMIN,
      isService: false,
      disabledAt: null,
    });
  });

  it('ne s’applique pas à un compte qui n’est pas administrateur', async () => {
    target({ role: Role.ARTIST });
    await expect(assertNotLastAdmin(1)).resolves.toBeUndefined();
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('ne s’applique ni à un compte de service ni à un administrateur déjà désactivé', async () => {
    target({ isService: true });
    await assertNotLastAdmin(1);
    target({ disabledAt: new Date() });
    await assertNotLastAdmin(1);
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('reste silencieux sur un compte inexistant (le 404 est le travail de l’appelant)', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(assertNotLastAdmin(404)).resolves.toBeUndefined();
  });
});

describe('changeRole — dernier administrateur', () => {
  it('refuse de rétrograder le dernier administrateur', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(changeRole(1, 1, Role.ARTIST)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('accepte la rétrogradation dès qu’un autre administrateur reste', async () => {
    db.user.count.mockResolvedValue(1);
    await changeRole(1, 2, Role.ARTIST);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 }, data: { role: Role.ARTIST } }),
    );
  });

  it('promouvoir en ADMIN ne compte rien', async () => {
    await changeRole(1, 2, Role.ADMIN);
    expect(db.user.count).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalled();
  });
});

describe('updateUser — dernier administrateur et désactivation', () => {
  it('refuse de rétrograder le dernier administrateur', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(updateUser(1, 1, { role: Role.SUPERVISOR })).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('refuse de désactiver le dernier administrateur', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(updateUser(1, 1, { disabled: true })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('désactive : date posée, identifiants révoqués, audit nommé USER_DISABLE', async () => {
    db.user.count.mockResolvedValue(1);
    await updateUser(1, 2, { disabled: true });
    expect(updateData().disabledAt).toBeInstanceOf(Date);
    expect(revokeAllCredentials).toHaveBeenCalledWith(2);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DISABLE' }));
  });

  it('réactive : la date retombe à null, audit nommé USER_ENABLE', async () => {
    target({ disabledAt: new Date('2026-01-01') });
    await updateUser(1, 2, { disabled: false });
    expect(updateData()).toEqual({ disabledAt: null });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ENABLE' }));
    // Réactiver ne coupe rien : les jetons ont déjà été révoqués à la désactivation.
    expect(revokeAllCredentials).not.toHaveBeenCalled();
  });

  it('re-désactiver ne rajeunit pas la date : c’est celle du départ', async () => {
    const departure = new Date('2026-01-01');
    target({ disabledAt: departure, role: Role.ARTIST });
    await updateUser(1, 2, { disabled: true });
    expect(updateData()).toEqual({ disabledAt: departure });
  });

  it('une édition ordinaire garde l’action USER_UPDATE', async () => {
    target({ role: Role.ARTIST });
    await updateUser(1, 2, { name: 'Ana' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_UPDATE' }));
  });
});

describe('setDisabled / deleteUser — chemin par défaut et geste explicite', () => {
  it('setDisabled écrit la date sans rien supprimer', async () => {
    target({ role: Role.ARTIST });
    await setDisabled(1, 2, true);
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(updateData().disabledAt).toBeInstanceOf(Date);
  });

  it('setDisabled refuse qu’on se désactive soi-même', async () => {
    await expect(setDisabled(1, 1, true)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('deleteUser refuse de supprimer le dernier administrateur', async () => {
    db.user.count.mockResolvedValue(0);
    await expect(deleteUser(1, 2)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('deleteUser refuse l’auto-suppression avant tout autre contrôle', async () => {
    await expect(deleteUser(1, 1)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('deleteUser révoque les partages ouverts par la personne, puis supprime', async () => {
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
