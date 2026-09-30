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
 * A1-04 / A2-06 — la clé d'avatar était comparée à un PRÉFIXE sans délimiteur
 * (`key.startsWith('avatars/' + userId)`). Or `StorageService.avatarKey` produit
 * `avatars/<id><ext>`, sans barre oblique après l'identifiant : `'avatars/91.png'`
 * commence donc par `'avatars/9'`, et le compte 9 faisait servir la photo du compte 91.
 *
 * L'impact direct est faible — un avatar est visible de tous les comptes authentifiés —,
 * mais c'est le contrôle qui, écrit correctement ailleurs (`DepartmentService.setImage`,
 * `EntityThumbnailService.set`), empêche de faire présigner un objet arbitraire du bucket.
 * Le laisser faux ici, c'est laisser le mauvais exemplaire à recopier : la route avait beau
 * avoir été durcie, le service — seul à écrire en base — restait la vraie source.
 */
describe('UserService.setAvatar — la clé doit désigner EXACTEMENT son propre avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({ id: 9, email: 'a@b.c', avatarKey: null } as never);
  });

  it('accepte la clé produite pour ce compte, dans les trois formats servis', async () => {
    for (const key of ['avatars/9.png', 'avatars/9.jpg', 'avatars/9.webp']) {
      await setAvatar(9, key);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { avatarKey: key } }));
    }
  });

  it('accepte le retrait de la photo', async () => {
    await setAvatar(9, null);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { avatarKey: null } }));
  });

  it('refuse la clé d’un compte dont l’identifiant commence par le sien', async () => {
    // Le défaut exact : 9 → 91, 1 → 12, 1 → 100.
    await expect(setAvatar(9, 'avatars/91.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(1, 'avatars/12.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(1, 'avatars/100.webp')).rejects.toMatchObject({ code: 'BAD_KEY' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse une clé hors du dossier des avatars, ou sans extension connue', async () => {
    // `avatars/` n'est qu'un préfixe du bucket : rien n'interdira demain qu'une autre clé
    // le partage. La garde nomme donc la forme entière, pas son début.
    await expect(setAvatar(9, 'derived/9/source.mp4')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9/../12.png')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9.exe')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, 'avatars/9')).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(setAvatar(9, '')).rejects.toMatchObject({ code: 'BAD_KEY' });
    expect(update).not.toHaveBeenCalled();
  });
});
