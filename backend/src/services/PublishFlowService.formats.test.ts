// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, Role } from '@prisma/client';

/**
 * Refus des formats illisibles **avant** le transfert.
 *
 * Le défaut corrigé ici est le plus coûteux de l'ingestion : la table d'extensions
 * annonçait EXR, DPX, TIFF, TGA, MXF et AVI, la validation d'en-tête ne les connaissait
 * pas, et le contrôle n'avait lieu qu'à la finalisation — soit après le transfert complet
 * du master. Deux garanties sont vérifiées : ce qui est annoncé passe, et ce qui n'est pas
 * lisible est refusé au premier appel, sans qu'un octet ait quitté le poste de l'artiste.
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

/** Type de média retenu par `start` au dernier appel. */
const lastKind = () => (createUpload.mock.calls.at(-1)?.[1] as { kind: MediaKind }).kind;

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start — formats réellement livrés en VFX', () => {
  it('ouvre la publication dʼun rendu EXR', async () => {
    await start(actor, { ...base, filename: 'SH0100_comp_v012.exr' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
  });

  it('ouvre la publication dʼune plaque DPX et dʼun matte TGA', async () => {
    await start(actor, { ...base, filename: 'SH0100_plate_v001.dpx' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
    await start(actor, { ...base, filename: 'SH0100_matte_v001.tga' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
  });

  it('ouvre la publication dʼun master MXF et dʼun AVI', async () => {
    await start(actor, { ...base, filename: 'SH0100_master_v003.mxf' });
    expect(lastKind()).toBe(MediaKind.VIDEO);
    await start(actor, { ...base, filename: 'SH0100_ref_v001.avi' });
    expect(lastKind()).toBe(MediaKind.VIDEO);
  });

  it('refuse un format illisible avant tout transfert, en nommant ce qui est accepté', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v012.psd' })).rejects.toMatchObject({
      code: 'KIND_UNKNOWN',
    });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuse aussi quand le client impose un « kind » que lʼextension ne peut pas honorer', async () => {
    await expect(
      start(actor, { ...base, filename: 'notes.txt', kind: MediaKind.IMAGE }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuse un EXR déclaré VIDEO : la validation dʼen-tête le rejetterait après coup', async () => {
    await expect(
      start(actor, { ...base, filename: 'SH0100_comp_v012.exr', kind: MediaKind.VIDEO }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('le message dʼerreur énumère les extensions admises pour ce type', async () => {
    await expect(start(actor, { ...base, filename: 'cache.abc', kind: MediaKind.MODEL_3D })).rejects.toThrow(
      /\.glb/,
    );
  });
});
