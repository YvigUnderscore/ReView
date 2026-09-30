// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

/**
 * Une séquence d'images ne se publie pas par la voie DCC en deux temps — et il faut le dire.
 *
 * `SH0100_comp_v003.%04d.exr` passe tous les contrôles de format : l'extension est `.exr`,
 * donc IMAGE, donc acceptée. Sans refus explicite, le DCC obtient une URL présignée, y
 * dépose une frame ou rien du tout, et crée un média nommé d'après un motif — muet,
 * inutilisable, et découvert des jours plus tard. C'est exactement la faute que la vague
 * précédente a corrigée sur les extensions annoncées mais non reconnues.
 */
const createUpload = vi.fn();

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: vi.fn() }));
vi.mock('../lib/v1Resources', () => ({
  versionSelect: {},
  mediaSelect: {},
  toVersion: (v: unknown) => v,
  toMedia: (m: unknown) => m,
}));
vi.mock('./MediaService', () => ({ createUpload: (...args: unknown[]) => createUpload(...args) }));
vi.mock('./PipelineEnsureService', () => ({
  ensurePath: vi.fn(async () => ({ taskId: 7, created: ['task'] })),
  ensureVersion: vi.fn(async () => ({ entity: { id: 12, name: 'V01' }, created: false })),
}));
vi.mock('./PipelineResolveService', () => ({ resolveProject: vi.fn(async () => ({ id: 3 })) }));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { start } from './PublishFlowService';

const actor = { id: 1, role: Role.SUPERVISOR, email: 'td@studio.test' };
const base = { path: 'PROJ/SQ010/SH0100/comp', createMissing: true };

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start — motif de séquence', () => {
  it('refuse un motif FFmpeg au lieu d’ouvrir un média vide', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v003.%04d.exr' })).rejects.toMatchObject({
      code: 'SEQUENCE_NOT_SUPPORTED_HERE',
    });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuse aussi la notation en dièses, celle des DCC', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v003.####.dpx' })).rejects.toMatchObject({
      code: 'SEQUENCE_NOT_SUPPORTED_HERE',
    });
  });

  it('nomme la route à utiliser à la place', async () => {
    await expect(start(actor, { ...base, filename: 'plan.%04d.exr' })).rejects.toThrow(
      /\/api\/media\/sequence\/init/,
    );
  });

  it('laisse passer une frame isolée, qui est un fichier comme un autre', async () => {
    await start(actor, { ...base, filename: 'SH0100_comp_v003.1001.exr' });
    expect(createUpload).toHaveBeenCalledTimes(1);
  });
});
