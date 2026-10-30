// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { comment, version, links, storage, annotationToSvg } = vi.hoisted(() => ({
  comment: { findUnique: vi.fn() },
  version: { findUnique: vi.fn() },
  links: { mapSgToLocal: vi.fn(), upsertLink: vi.fn(), findByLocal: vi.fn() },
  // The storage is the double that matters here: it is what the dead branch (`Comment.screenshotKey`) queried.
  // It must stay silent.
  storage: { getObjectBuffer: vi.fn(), downloadToFile: vi.fn() },
  annotationToSvg: vi.fn(() => null),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { comment, version } }));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/annotationSvg', () => ({ annotationToSvg }));
vi.mock('../../config/env', () => ({ env: { APP_URL: null } }));
vi.mock('../MediaService', () => ({ mediaSourceKey: vi.fn(() => 'key') }));
vi.mock('../../lib/storage', () => ({ storage }));
vi.mock('./ShotgridNoteAttachments', () => ({ importNoteAttachments: vi.fn(async () => 0) }));
vi.mock('./ShotgridPullService', () => ({ touch: vi.fn(), confirmGone: vi.fn(async () => []) }));
vi.mock('./shotgridSettings', () => ({ can: () => true }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: (...args: unknown[]) => links.mapSgToLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
}));

import { pushComment } from './ShotgridNoteSync';

function context(attachAnnotations: boolean) {
  const createAs = vi.fn(async () => ({ id: 4242, type: 'Note' }));
  const uploadFile = vi.fn(async () => true);
  return {
    ctx: {
      connectionId: 1,
      sgProjectId: 77,
      writer: { create: createAs, upload: uploadFile },
      attachAnnotations,
      asUserLogin: null,
    },
    createAs,
    uploadFile,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  comment.findUnique.mockResolvedValue({
    id: 12,
    content: '<p>Le raccord saute</p>',
    timestamp: 4,
    annotation: { strokes: [] },
    author: { name: 'Léa', email: 'lea@studio.fr' },
    media: {
      id: 71,
      versionId: 31,
      metadata: { frameRate: 25 },
      storageKey: 'k',
      mimeType: 'video/mp4',
    },
  });
  version.findUnique.mockResolvedValue({ name: 'sh010_v003' });
  links.findByLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'version' ? { sgId: 900 } : null,
  );
  links.upsertLink.mockResolvedValue(undefined);
});

describe('pushComment: attachment of the annotated frame', () => {
  it('attaches nothing when the annotation yields no image', async () => {
    // `Comment.screenshotKey` used to be read first to attach an already computed capture, but nothing in the repository ever wrote this column:
    // the branch was dead and the fallback the only path. The column and its reading left together; so composing the frame is the ONLY possible source.
    // Without an SVG to burn in, there is no image, hence no attachment.
    const { ctx, uploadFile } = context(true);
    annotationToSvg.mockReturnValue(null);

    await expect(pushComment(ctx as never, 12)).resolves.toBe(4242);

    expect(uploadFile).not.toHaveBeenCalled();
    // No capture is looked up in MinIO: nobody reads a capture key any more.
    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    expect(storage.downloadToFile).not.toHaveBeenCalled();
  });

  it('sets the comment match on the created Note', async () => {
    const { ctx, createAs } = context(false);

    await pushComment(ctx, 12);

    expect(createAs).toHaveBeenCalledTimes(1);
    expect(links.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ localType: 'comment', localId: 12, sgType: 'Note', sgId: 4242 }),
    );
  });

  it('does not create a second note for an already pushed comment', async () => {
    const { ctx, createAs } = context(true);
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'version' ? { sgId: 900 } : { sgId: 4242 },
    );

    await expect(pushComment(ctx as never, 12)).resolves.toBe(4242);
    expect(createAs).not.toHaveBeenCalled();
  });
});
