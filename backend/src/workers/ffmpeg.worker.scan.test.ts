// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Traçabilité du scan antivirus (A4-04).
 *
 * Un job `kind: 'scan'` porte sur un média déjà READY et déjà téléchargeable : son échec ne
 * change rien au média, c'est le seul chemin où l'antivirus ne conditionne rien. Il doit donc
 * laisser une trace dans les deux sens — sans quoi un fichier jamais scanné (clamd redémarré
 * pendant la fenêtre de dépôt) est rigoureusement indiscernable d'un fichier scanné et sain.
 */

/**
 * Processeurs passés à BullMQ au chargement du module, par file. Le module en enregistre
 * plusieurs (nettoyage storage, webhooks, ShotGrid…) : on ne garde que celui de la file
 * média, c'est lui qu'on exerce.
 */
const { processors } = vi.hoisted(() => ({
  processors: new Map<string, (job: unknown) => Promise<unknown>>(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      readonly name: string,
      proc: (job: unknown) => Promise<unknown>,
      readonly opts: unknown,
    ) {
      processors.set(name, proc);
    }
    on() {
      return this;
    }
    run() {
      return Promise.resolve();
    }
  },
  Queue: class {
    add() {
      return Promise.resolve({});
    }
  },
  QueueEvents: class {
    on() {
      return this;
    }
  },
}));

vi.mock('../lib/redis', () => ({
  redisConnectionOptions: {},
  redis: { on: vi.fn(), quit: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../services/StorageService', () => ({
  storage: {
    downloadToFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    copyObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  },
  StorageService: { thumbnailKey: (id: number, ext: string) => `derived/${id}/thumbnail.${ext}` },
}));

vi.mock('../lib/clamav', () => ({
  isClamavEnabled: vi.fn(() => true),
  scanFile: vi.fn(),
}));

vi.mock('../lib/workerEvents', () => ({
  publishWorkerEvent: vi.fn(),
  closeWorkerEvents: vi.fn(),
}));

// Mock partiel : d'autres modules chargés au passage lisent les constantes de rétention.
vi.mock('../services/AuditService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logAudit: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import './ffmpeg.worker';
import { prisma } from '../lib/prisma';
import { scanFile } from '../lib/clamav';

const MEDIA_ID = 77;

/** Média sans job de traitement (GLB, splat) : READY dès la finalisation. */
function media(metadata: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    kind: 'MODEL_3D',
    originalName: 'hero.glb',
    storageKey: 'projects/p/v/77/hero.glb',
    status: 'READY',
    metadata,
    imageSequence: null,
  };
}

/** Métadonnées écrites par le dernier `update` sur le média. */
function lastWrittenMetadata(): Record<string, unknown> {
  const calls = vi.mocked(prisma.mediaObject.update).mock.calls;
  return (calls.at(-1)![0] as { data: { metadata: Record<string, unknown> } }).data.metadata;
}

/** Le processeur de la file média, enregistré à l'import du module. */
const runJob = (): Promise<unknown> =>
  processors.get('media-processing')!({
    data: { mediaObjectId: MEDIA_ID, kind: 'scan' },
    // Le rapporteur de progression chaîne un `.catch` sur ce retour.
    updateProgress: () => Promise.resolve(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);
  vi.mocked(prisma.mediaObject.update).mockResolvedValue({} as never);
});

describe('job « scan » — le verdict est écrit sur le média', () => {
  it('marque la date de scan quand clamd rend un verdict propre', async () => {
    vi.mocked(scanFile).mockResolvedValue({ clean: true, virus: null });
    await runJob();
    expect(typeof lastWrittenMetadata().scannedAt).toBe('string');
  });

  it('efface une marque d’échec que la tentative réussie vient de rattraper', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ scanFailed: 'clamd: connection closed', scanFailedAt: '2026-09-16T09:00:00.000Z' }) as never,
    );
    vi.mocked(scanFile).mockResolvedValue({ clean: true, virus: null });
    await runJob();
    const written = lastWrittenMetadata();
    expect(written.scanFailed).toBeUndefined();
    expect(written.scanFailedAt).toBeUndefined();
  });

  it('inscrit la raison sur le média quand clamd est injoignable', async () => {
    // Le cas qui laissait le média READY, téléchargeable et muet : le job épuisait ses
    // tentatives en trente-cinq secondes et disparaissait sans écrire une ligne.
    vi.mocked(scanFile).mockRejectedValue(new Error('connect ECONNREFUSED clamav:3310'));
    await expect(runJob()).rejects.toThrow('ECONNREFUSED');
    const written = lastWrittenMetadata();
    expect(written.scanFailed).toContain('ECONNREFUSED');
    expect(typeof written.scanFailedAt).toBe('string');
    expect(written.scannedAt).toBeUndefined();
  });

  it('ne passe jamais le média en FAILED sur un scan en erreur', async () => {
    // Le fichier est sain jusqu'à preuve du contraire : seule une DÉTECTION met FAILED.
    vi.mocked(scanFile).mockRejectedValue(new Error('clamd: scan timed out'));
    await expect(runJob()).rejects.toThrow();
    const calls = vi.mocked(prisma.mediaObject.update).mock.calls;
    for (const [args] of calls) {
      expect((args as { data: { status?: string } }).data.status).toBeUndefined();
    }
  });
});
