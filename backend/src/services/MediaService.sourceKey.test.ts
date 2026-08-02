// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { mediaSourceKey } from './MediaService';

describe('mediaSourceKey — source servie après suppression de l’original', () => {
  it('sert la clé originale tant que la source existe', () => {
    expect(mediaSourceKey({ storageKey: 'k/orig.mp4', metadata: { proxyKey: 'derived/1/proxy.mp4' } })).toBe(
      'k/orig.mp4',
    );
    expect(mediaSourceKey({ storageKey: 'k/img.png', metadata: null })).toBe('k/img.png');
  });

  it('sert le proxy quand la source a été supprimée après transcodage', () => {
    expect(
      mediaSourceKey({
        storageKey: 'k/orig.mp4',
        metadata: { sourceDeleted: true, proxyKey: 'derived/1/proxy.mp4' },
      }),
    ).toBe('derived/1/proxy.mp4');
  });

  it('retombe sur la clé originale si le flag est posé sans proxy (incohérence défensive)', () => {
    expect(mediaSourceKey({ storageKey: 'k/orig.mp4', metadata: { sourceDeleted: true } })).toBe(
      'k/orig.mp4',
    );
  });
});
