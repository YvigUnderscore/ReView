// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

/**
 * Transmission de la sélection USD à la création du média. Tout ce qui touche la base, le
 * stockage et les files est neutralisé : ce qui est vérifié ici, c'est le trajet de `usd`
 * jusqu'à `MediaService.createUpload`, seule écriture qui pose `metadata.usdRequest`.
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
  ensureVersion: vi.fn(async () => ({ entity: { id: 12, name: 'V01' }, created: true })),
}));
vi.mock('./PipelineResolveService', () => ({ resolveProject: vi.fn(async () => ({ id: 3 })) }));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { start } from './PublishFlowService';

const actor = { id: 1, role: Role.SUPERVISOR, email: 'td@studio.test' };
const base = { path: 'PROJ/SQ010/SH0100/anim', filename: 'SH0100_set_v001.usd', createMissing: true };

/** Ce que `createUpload` a reçu au dernier appel. */
const lastUpload = () => createUpload.mock.calls.at(-1)?.[1] as { usdRequest?: unknown };

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start — sélection USD', () => {
  it('transmet la sélection au média créé', async () => {
    const usd = { variants: { '/World/Set': { modelingVariant: 'hero' } }, purpose: 'proxy' as const };
    await start(actor, { ...base, usd });
    expect(lastUpload().usdRequest).toEqual(usd);
  });

  it('ne pose rien quand le client ne demande rien — la conversion garde ses valeurs par défaut', async () => {
    await start(actor, base);
    expect(lastUpload().usdRequest).toBeUndefined();
  });

  it('refuse la sélection sur un média qui ne sera jamais converti en USD', async () => {
    await expect(
      start(actor, { ...base, filename: 'SH0100_anim_v001.mov', usd: { variants: {}, purpose: 'render' } }),
    ).rejects.toMatchObject({ code: 'USD_NOT_3D' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("laisse passer une sélection dont les variantSets n'existent peut-être pas", async () => {
    // À la publication, la scène n'a pas encore été analysée : filtrer ici est impossible.
    // Le filtrage a lieu à la conversion (`sanitizeVariantSelection`), pas avant.
    const usd = { variants: { '/Nowhere': { inventé: 'jamais' } }, purpose: 'render' as const };
    await start(actor, { ...base, usd });
    expect(lastUpload().usdRequest).toEqual(usd);
  });
});
