// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { mediaSourceKey, mediaViewKey } from './MediaService';

describe('mediaSourceKey: source served after the original is deleted', () => {
  it('serves the original key as long as the source exists', () => {
    expect(mediaSourceKey({ storageKey: 'k/orig.mp4', metadata: { proxyKey: 'derived/1/proxy.mp4' } })).toBe(
      'k/orig.mp4',
    );
    expect(mediaSourceKey({ storageKey: 'k/img.png', metadata: null })).toBe('k/img.png');
  });

  it('serves the proxy when the source was deleted after transcoding', () => {
    expect(
      mediaSourceKey({
        storageKey: 'k/orig.mp4',
        metadata: { sourceDeleted: true, proxyKey: 'derived/1/proxy.mp4' },
      }),
    ).toBe('derived/1/proxy.mp4');
  });

  it('falls back on the original key if the flag is set without a proxy (defensive inconsistency)', () => {
    expect(mediaSourceKey({ storageKey: 'k/orig.mp4', metadata: { sourceDeleted: true } })).toBe(
      'k/orig.mp4',
    );
  });
});

/**
 * The viewer cannot display an EXR: it must receive the JPEG proxy produced by the worker. The source, for
 * its part, remains what the artist deposited — it is that which is downloaded, sent to ShotGrid and served
 * by the API v1.
 */
describe('mediaViewKey: key actually displayable', () => {
  it('serves the web proxy of a production image', () => {
    expect(
      mediaViewKey({ storageKey: 'k/plate.exr', metadata: { webProxyKey: 'derived/9/proxy.jpg' } }),
    ).toBe('derived/9/proxy.jpg');
  });

  it('serves the original for an image that the browser can read', () => {
    expect(mediaViewKey({ storageKey: 'k/ref.png', metadata: {} })).toBe('k/ref.png');
    expect(mediaViewKey({ storageKey: 'k/ref.png', metadata: null })).toBe('k/ref.png');
  });

  it('does not diverge from mediaSourceKey on video: the MP4 proxy remains the source', () => {
    const media = {
      storageKey: 'k/master.mxf',
      metadata: { sourceDeleted: true, proxyKey: 'derived/4/proxy.mp4' },
    };
    expect(mediaViewKey(media)).toBe(mediaSourceKey(media));
  });

  it('ignores an empty key rather than serving a hollow URL', () => {
    expect(mediaViewKey({ storageKey: 'k/plate.exr', metadata: { webProxyKey: '' } })).toBe('k/plate.exr');
  });
});
