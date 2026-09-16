// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: { findUnique: vi.fn() },
    // Résolution Version → Projet (`lib/pipeline`, laissé réel).
    version: { findUnique: vi.fn() },
    // Rôle par projet (38.E), lu par `lib/projectRoles` — laissé réel lui aussi : mocker
    // la garde qu'on éprouve rendrait le test aveugle au contournement A1-03.
    projectMembership: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), getLiveSyncHz: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { assertMediaManage } from './MediaService';
import { checkProjectAccess } from '../middleware/rbac';

const PROJECT = 42;
/** Média déposé par l'utilisateur 7 avant sa rétrogradation. */
const OWN_MEDIA = { uploaderId: 7, versionId: 3 };
/** Média déposé par quelqu'un d'autre. */
const OTHER_MEDIA = { uploaderId: 99, versionId: 3 };

/** Ce que `projectMembership.findUnique` doit rendre pour un rôle local donné. */
const membership = (role: Role | null) => ({ userId: 7, projectId: PROJECT, role });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true); // membre : l'appartenance ne suffit pas
  db.version.findUnique.mockResolvedValue({ asset: { projectId: PROJECT }, task: null });
  db.mediaObject.findUnique.mockResolvedValue(OWN_MEDIA);
  db.projectMembership.findUnique.mockResolvedValue(membership(null));
});

/**
 * A1-03 — `assertMediaManage` décidait sur le rôle GLOBAL (`user.role === ADMIN ||
 * SUPERVISOR`) après n'avoir vérifié que l'appartenance au projet. Un ARTIST rétrogradé
 * CLIENT (38.E) gardait son `ProjectMembership`, donc `checkProjectAccess` disait oui, et
 * il continuait de corbeiller, reprocesser, retrimmer et retoucher les médias qu'il avait
 * déposés. C'est la porte d'entrée de toute la gestion média : corbeille, reprocess,
 * miniature, trim, éditions splat, overrides USD, actions en lot.
 */
describe('assertMediaManage — rôle effectif par projet (38.E)', () => {
  const artist = { id: 7, role: Role.ARTIST };

  it('laisse l’uploader gérer son média tant qu’il contribue au projet', async () => {
    await expect(assertMediaManage(1, artist)).resolves.toEqual({ projectId: PROJECT, versionId: 3 });
  });

  it('refuse un ARTIST rétrogradé CLIENT, même sur le média qu’il a déposé', async () => {
    db.projectMembership.findUnique.mockResolvedValue(membership(Role.CLIENT));
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
  });

  it('refuse le média d’autrui à un simple contributeur', async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('inversement : un ARTIST promu SUPERVISOR localement gère le média d’un autre', async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    db.projectMembership.findUnique.mockResolvedValue(membership(Role.SUPERVISOR));
    await expect(assertMediaManage(1, artist)).resolves.toEqual({ projectId: PROJECT, versionId: 3 });
  });

  it('un ADMIN global reste ADMIN partout, sans membership', async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(assertMediaManage(1, { id: 1, role: Role.ADMIN })).resolves.toMatchObject({
      projectId: PROJECT,
    });
  });
});
