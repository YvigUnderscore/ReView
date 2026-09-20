// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

/**
 * Le bloc `permissions` du détail média (Phase 50, lot 6).
 *
 * L'écran décidait seul d'afficher les gizmos et le bouton « Enregistrer » du mode
 * « Nettoyer », sur la règle « version non publiée + rôle interne ». Le serveur exige en plus
 * l'auteur de la version ou un gestionnaire du projet : un ARTIST membre non auteur voyait donc
 * un bouton refusé ensuite en 403. Le détail porte désormais la réponse du serveur, et c'est
 * elle que le viewer lit — ce test l'éprouve sur le chemin réel de `getDetail`.
 */

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: { findUnique: vi.fn() },
    version: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    reviewReference: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(() => Promise.resolve('https://minio.invalid/signed')) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./ChatNotifyService', () => ({ notifyChat: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./ReviewAssignmentService', () => ({
  listReviewers: vi.fn(() => Promise.resolve([])),
  setReviewers: vi.fn(),
}));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../lib/clamav', () => ({ isClamavEnabled: () => false }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../lib/projectRoles', () => ({ assertCanContribute: vi.fn(), isProjectManager: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(() => Promise.resolve(PROJECT)),
  resolveStorageContextForVersion: vi.fn(),
}));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(),
  getLiveSyncHz: vi.fn(() => Promise.resolve(2)),
  isDraftModeEnabled: vi.fn(() => Promise.resolve(false)),
  SETTING_KEYS: {},
}));
vi.mock('../lib/projectSettings', () => ({
  checkNaming: vi.fn(),
  resolveProjectSettingsById: vi.fn(() =>
    Promise.resolve({
      defaultLighting: null,
      color: null,
      reviewRequest: { requireNote: false, minNoteLength: 5 },
    }),
  ),
}));

import { getDetail } from './MediaService';
import { isProjectManager } from '../lib/projectRoles';

const PROJECT = 42;
const MEDIA_ID = 9;
const VERSION_ID = 3;
const AUTHOR = 7;
const OTHER = 8;

const media = {
  id: MEDIA_ID,
  kind: MediaKind.MODEL_3D,
  status: MediaStatus.READY,
  published: true,
  versionId: VERSION_ID,
  uploaderId: AUTHOR,
  originalName: 'sh0010_model_v001.usdz',
  storageKey: 'projects/p/sh/v/9/model.usdz',
  thumbnailKey: null,
  size: BigInt(1024),
  metadata: {},
};

/** Interroge le détail au nom d'un utilisateur, avec une version donnée. */
async function detailFor(opts: {
  userId: number;
  authorId: number | null;
  published: boolean;
  manager: boolean;
}) {
  db.mediaObject.findUnique.mockResolvedValue(media);
  db.version.findUnique.mockResolvedValue({ authorId: opts.authorId, published: opts.published });
  db.project.findUnique.mockResolvedValue({ startFrame: 1001 });
  db.reviewReference.findMany.mockResolvedValue([]);
  vi.mocked(isProjectManager).mockResolvedValue(opts.manager);
  const detail = await getDetail({ id: opts.userId, role: Role.ARTIST }, MEDIA_ID);
  return detail.permissions;
}

describe('getDetail — bloc permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accorde la transformation à l’auteur d’une version non publiée', async () => {
    expect(await detailFor({ userId: AUTHOR, authorId: AUTHOR, published: false, manager: false })).toEqual({
      editTransform: true,
    });
  });

  it('l’accorde au gestionnaire du projet qui n’est pas l’auteur', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: false, manager: true })).toEqual({
      editTransform: true,
    });
  });

  it('la refuse au membre interne ni auteur ni gestionnaire — c’était le bouton mort', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: false, manager: false })).toEqual({
      editTransform: false,
    });
  });

  it('la refuse dès que la version est publiée, même à un gestionnaire', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: true, manager: true })).toEqual({
      editTransform: false,
    });
  });

  it('interroge la version du média, et le rôle effectif sur SON projet', async () => {
    await detailFor({ userId: AUTHOR, authorId: AUTHOR, published: false, manager: false });
    expect(db.version.findUnique).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      select: { authorId: true, published: true },
    });
    expect(vi.mocked(isProjectManager)).toHaveBeenCalledWith(AUTHOR, Role.ARTIST, PROJECT);
  });
});
