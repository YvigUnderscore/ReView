// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

/**
 * Publication d'office (Phase 50) — le lot qui retire « publier » de la liste des gestes.
 *
 * Trois règles s'y jouent, et elles se tiennent : un média naît publié sauf si le studio a
 * gardé le mode brouillon ; la consigne obligatoire, qui refusait autrefois la publication,
 * refuse maintenant l'upload ; et un média publié dont le traitement a échoué garde droit à
 * UNE relance, sans quoi il serait mort à jamais.
 */

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    version: { findUnique: vi.fn(), update: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    // Le compteur de relance se lit et se dépense SOUS VERROU DE LIGNE (CP-SEC phase 50) :
    // `reprocess` passe donc par une transaction interactive. Le bouchon la joue à plat, avec
    // le même client — ce que le test éprouve est la règle du compteur, pas le verrou, qui
    // n'a de sens que contre une vraie base (et que le test d'intégration exerce).
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedPutUrl: vi.fn(),
    getPresignedGetUrl: vi.fn(),
    statObject: vi.fn(),
    getObjectHeader: vi.fn(),
    setObjectContentType: vi.fn(),
    deleteObject: vi.fn(),
  },
  StorageService: { mediaKey: vi.fn(() => 'projects/p/sh/v/1/f.mov'), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({
  enqueueMediaJob: vi.fn(() => Promise.resolve()),
  enqueueSpatialThumb: vi.fn(() => Promise.resolve()),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./ChatNotifyService', () => ({ notifyChat: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./ReviewAssignmentService', () => ({ listReviewers: vi.fn(), setReviewers: vi.fn() }));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../lib/clamav', () => ({ isClamavEnabled: () => false }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../lib/projectRoles', () => ({ assertCanContribute: vi.fn(), isProjectManager: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(() => Promise.resolve(PROJECT)),
  resolveStorageContextForVersion: vi.fn(() =>
    Promise.resolve({ projectId: PROJECT, projectSlug: 'demo', parentSegment: 'sh0010', versionName: 'v01' }),
  ),
}));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(() => Promise.resolve(Number.MAX_SAFE_INTEGER)),
  getLiveSyncHz: vi.fn(() => Promise.resolve(2)),
  isDraftModeEnabled: vi.fn(() => Promise.resolve(false)),
  SETTING_KEYS: {
    MAX_FILE_SIZE: 'max_file_size',
    MAX_CONCURRENT_UPLOADS: 'max_concurrent_uploads',
    STORAGE_LIMIT_USER: 'storage_limit_user',
  },
}));
// La règle de consigne reste RÉELLE (`checkReviewNote`) : c'est elle qu'on éprouve. Seule la
// lecture des réglages du projet est simulée.
vi.mock('../lib/projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));
// Le contenu déposé n'est pas l'objet du test : la détection est simulée, les magic bytes
// sont éprouvés dans `lib/fileSignatures`.
vi.mock('../lib/fileSignatures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/fileSignatures')>()),
  validateMediaHeader: vi.fn(() => 'mov'),
}));

import { createUpload, finalize, reprocess } from './MediaService';
import { storage } from './StorageService';
import { enqueueMediaJob } from './JobService';
import { isDraftModeEnabled } from '../lib/settings';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { notifyWatchers } from './WatchService';

const PROJECT = 42;
const USER = { id: 7, role: Role.ARTIST };

/** Les réglages du projet, réduits aux deux sections que ce chemin lit. */
const settings = (requireNote: boolean, minNoteLength = 5) =>
  ({ naming: { pattern: '', mode: 'off' }, reviewRequest: { requireNote, minNoteLength } }) as never;

const upload = () => ({
  versionId: 3,
  filename: 'sh0010_comp_v001.mov',
  contentType: 'video/quicktime',
  kind: MediaKind.VIDEO,
  size: 1024,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isDraftModeEnabled).mockResolvedValue(false);
  vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(false));
  db.mediaObject.count.mockResolvedValue(0);
  db.mediaObject.aggregate.mockResolvedValue({ _sum: { size: 0n } });
  db.mediaObject.create.mockResolvedValue({ id: 1 });
  // Prisma rend la LIGNE COMPLÈTE après un update : `published` en fait partie, et c'est lui
  // qui décide si la finalisation annonce la publication. Un mock qui ne renvoie que le
  // `data` écrit laisserait ce chemin muet sans que rien ne le signale.
  db.mediaObject.update.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: 1,
    versionId: 3,
    kind: MediaKind.VIDEO,
    originalName: 'sh0010_comp_v001.mov',
    published: true,
    size: 0n,
    metadata: {},
    ...args.data,
  }));
  // Sert deux lectures : l'état publié du parent (createUpload) et la liste des médias que
  // `syncVersionPublication` compte. Une version vide ne se publie pas — défaut neutre.
  db.version.findUnique.mockResolvedValue({ published: false, media: [] });
  db.user.findUnique.mockResolvedValue({ storageLimit: null });
  vi.mocked(storage.getPresignedPutUrl).mockResolvedValue('https://minio.invalid/put');
});

describe('createUpload — naissance publiée selon le réglage `draftMode`', () => {
  it('publie d’office quand le mode brouillon est désactivé (défaut)', async () => {
    const res = await createUpload(USER, upload());

    expect(res.published).toBe(true);
    expect(db.mediaObject.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ published: true }) }),
    );
  });

  it('garde le brouillon quand le mode brouillon est actif', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);

    const res = await createUpload(USER, upload());

    expect(res.published).toBe(false);
    expect(db.mediaObject.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ published: false }) }),
    );
  });

  it('en mode brouillon, hérite tout de même de la version déjà publiée', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);
    db.version.findUnique.mockResolvedValue({ published: true });

    expect((await createUpload(USER, upload())).published).toBe(true);
  });
});

describe('finalize — consigne obligatoire déplacée à l’upload', () => {
  beforeEach(() => {
    db.mediaObject.findUnique.mockResolvedValue({
      id: 1,
      versionId: 3,
      kind: MediaKind.VIDEO,
      originalName: 'sh0010_comp_v001.mov',
      storageKey: 'projects/demo/sh0010/v01/1/f.mov',
      status: MediaStatus.UPLOADING,
      published: true,
      uploaderId: USER.id,
      metadata: {},
    });
    vi.mocked(storage.statObject).mockResolvedValue({ size: 2048, contentType: 'video/quicktime' });
    vi.mocked(storage.getObjectHeader).mockResolvedValue(Buffer.alloc(32));
    vi.mocked(storage.setObjectContentType).mockResolvedValue(undefined);
  });

  it('refuse l’upload sans consigne quand le projet l’exige — avant tout appel au stockage', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true));

    await expect(finalize(USER, 1)).rejects.toMatchObject({
      statusCode: 400,
      code: 'UPLOAD_NOTE_REQUIRED',
    });
    // Rien n'a été touché : le client peut rappeler `finalize` avec sa consigne.
    expect(storage.statObject).not.toHaveBeenCalled();
    expect(db.mediaObject.update).not.toHaveBeenCalled();
  });

  it('refuse une consigne plus courte que le plancher du projet', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true, 10));

    await expect(finalize(USER, 1, 'ok')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UPLOAD_NOTE_TOO_SHORT',
    });
  });

  it('accepte l’upload avec sa consigne, et la garde dans les métadonnées', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true));

    await finalize(USER, 1, '  Regarder le raccord au 1042  ');

    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { uploadNote: 'Regarder le raccord au 1042' } }),
      }),
    );
  });

  it('laisse passer l’upload sans consigne quand le projet n’en exige pas', async () => {
    await expect(finalize(USER, 1)).resolves.toMatchObject({ detectedExtension: 'mov' });
  });

  it('annonce la publication d’office : la version suit, les suiveurs sont prévenus', async () => {
    db.version.findUnique.mockResolvedValue({
      published: false,
      media: [{ published: true, status: MediaStatus.READY }],
    });

    await finalize(USER, 1);

    expect(db.version.update).toHaveBeenCalled();
    expect(notifyWatchers).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'notification.mediaPublished' }),
    );
  });

  it('en mode brouillon, n’annonce rien : « publier » reste un geste', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);
    db.version.findUnique.mockResolvedValue({
      published: false,
      media: [{ published: true, status: MediaStatus.READY }],
    });

    await finalize(USER, 1);

    expect(db.version.update).not.toHaveBeenCalled();
    expect(notifyWatchers).not.toHaveBeenCalled();
  });
});

describe('reprocess — une relance après échec, aucune sur un média sain', () => {
  /** `assertMediaManage` passe : l'utilisateur est un superviseur du projet. */
  const manage = { id: 7, role: Role.SUPERVISOR };

  const media = (over: Record<string, unknown>) => ({
    id: 1,
    versionId: 3,
    uploaderId: manage.id,
    kind: MediaKind.MODEL_3D,
    originalName: 'asset.fbx',
    published: true,
    status: MediaStatus.FAILED,
    metadata: {},
    ...over,
  });

  beforeEach(() => {
    db.version.findUnique.mockResolvedValue({ asset: { projectId: PROJECT }, task: null });
    db.projectMembership.findUnique.mockResolvedValue({ userId: manage.id, projectId: PROJECT, role: null });
  });

  it('refuse la relance d’un média publié SAIN, avec son propre code', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ status: MediaStatus.READY }));

    await expect(reprocess(manage, 1)).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPROCESS_ONLY_AFTER_FAILURE',
    });
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });

  it('autorise la première relance d’un média publié en échec, et la compte', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({}));

    const res = await reprocess(manage, 1);

    expect(res.requeued).toBe(true);
    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { publishedReprocessCount: 1 } }),
      }),
    );
  });

  it('refuse la deuxième relance, le compteur étant consommé', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ metadata: { publishedReprocessCount: 1 } }));

    await expect(reprocess(manage, 1)).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPROCESS_ALREADY_RETRIED',
    });
  });

  it('ne compte rien sur un brouillon : sa relance reste libre', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ published: false, status: MediaStatus.READY }));

    await reprocess(manage, 1);

    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: MediaStatus.PROCESSING } }),
    );
  });
});
