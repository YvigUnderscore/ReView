// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { putObject, deleteObject, setThumbnail } = vi.hoisted(() => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  setThumbnail: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
  storage: {
    putObject: (...a: unknown[]) => putObject(...a),
    deleteObject: (...a: unknown[]) => deleteObject(...a),
  },
  StorageService: {
    entityThumbnailKey: (holder: string, id: number, ext: string) => `entity-thumbs/${holder}/${id}${ext}`,
  },
}));
vi.mock('../EntityThumbnailService', () => ({
  set: (...a: unknown[]) => setThumbnail(...a),
}));

import { syncThumbnail, thumbnailIdentity } from './ShotgridThumbnails';
import type { PullContext } from './ShotgridPullService';

/** URL as the site returns it: a content-addressed path, volatile signature. */
const URL_V1 =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=aaa';
const URL_V1_RESIGNED =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=zzz';
const URL_V2 =
  'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/9999/sh010_t.jpg?X-Amz-Expires=900&X-Amz-Signature=bbb';

const openStream = vi.fn();

function context(thumbnails = true): PullContext {
  return {
    connection: { id: 1, projectId: 7 },
    client: { openStream },
    settings: { media: { thumbnails } },
    journal: { count: vi.fn(), log: vi.fn() },
  } as unknown as PullContext;
}

const params = (over: Partial<Parameters<typeof syncThumbnail>[1]> = {}) => ({
  holder: 'shot' as const,
  localId: 12,
  sgType: 'Shot',
  sgId: 25564,
  name: 'sh010',
  image: URL_V1,
  previous: null as string | null,
  currentKey: null as string | null,
  ...over,
});

const respond = (bytes: Buffer, type: string | null = 'image/jpeg', size: number | null = bytes.length) =>
  openStream.mockResolvedValue({ stream: Readable.from([bytes]), size, type });

beforeEach(() => {
  vi.clearAllMocks();
  openStream.mockReset();
  // These three are awaited: a double returning `undefined` would make the code fail for a reason unrelated to what is being checked.
  putObject.mockResolvedValue(undefined);
  deleteObject.mockResolvedValue(undefined);
  setThumbnail.mockResolvedValue(undefined);
});

/**
 * The `image` field returns a signed URL that changes at every read: using it as is as a change marker would re-download all the project's thumbnails at every pass.
 * Only the path, addressed by content, says whether the image has moved.
 */
describe('thumbnailIdentity', () => {
  it('removes the signature and keeps the path', () => {
    expect(thumbnailIdentity(URL_V1)).toBe(
      'https://sg-media-usor-01.s3-accelerate.amazonaws.com/a700/4352/sh010_t.jpg',
    );
  });

  it('returns the same marker for two signatures of the same image', () => {
    expect(thumbnailIdentity(URL_V1)).toBe(thumbnailIdentity(URL_V1_RESIGNED));
  });

  it('tells two different images apart', () => {
    expect(thumbnailIdentity(URL_V1)).not.toBe(thumbnailIdentity(URL_V2));
  });

  it('reads "no thumbnail" where the site returns nothing', () => {
    expect(thumbnailIdentity(null)).toBeNull();
    expect(thumbnailIdentity(undefined)).toBeNull();
    expect(thumbnailIdentity('')).toBeNull();
    expect(thumbnailIdentity({ url: 'https://exemple' })).toBeNull();
  });
});

describe('syncThumbnail', () => {
  it('fetches the thumbnail and sets it on the entity', async () => {
    respond(Buffer.from('jpeg'));
    const identity = await syncThumbnail(context(), params());

    expect(openStream).toHaveBeenCalledWith(URL_V1);
    expect(putObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg', expect.any(Buffer), 'image/jpeg');
    expect(setThumbnail).toHaveBeenCalledWith('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(identity).toBe(thumbnailIdentity(URL_V1));
  });

  /**
   * By far the most frequent case: a nightly reconciliation re-reads the whole project while nothing has changed. Re-downloading twelve thousand images for nothing would
   * make the catch-up pass the most costly pass of the integration.
   */
  it('re-downloads nothing when only the signature has changed', async () => {
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V1_RESIGNED,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(openStream).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(identity).toBe(thumbnailIdentity(URL_V1));
  });

  it('fetches again when the image has really changed', async () => {
    respond(Buffer.from('jpeg2'));
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(openStream).toHaveBeenCalledWith(URL_V2);
    expect(identity).toBe(thumbnailIdentity(URL_V2));
  });

  /** The marker is there but the object has vanished from storage: we go and fetch it again. */
  it('fetches back when the entity lost its thumbnail despite an identical marker', async () => {
    respond(Buffer.from('jpeg'));
    await syncThumbnail(context(), params({ previous: thumbnailIdentity(URL_V1), currentKey: null }));

    expect(openStream).toHaveBeenCalled();
  });

  it('removes the thumbnail when production removes it from the site', async () => {
    const identity = await syncThumbnail(
      context(),
      params({
        image: null,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(deleteObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
    expect(setThumbnail).toHaveBeenCalledWith('shot', 12, null);
    expect(identity).toBeNull();
  });

  /**
   * A thumbnail placed by hand in ReView never had a marker: it does not come from the site. Neither erasing it when ShotGrid does not illustrate the shot, nor covering it
   * when it does — it is a human decision, and covering it on the first pass would have erased it across a whole project at once.
   */
  it('does not erase a thumbnail placed by hand when the site has none', async () => {
    await syncThumbnail(
      context(),
      params({ image: null, previous: null, currentKey: 'entity-thumbs/shot/12.jpg' }),
    );

    expect(deleteObject).not.toHaveBeenCalled();
    expect(setThumbnail).not.toHaveBeenCalled();
  });

  it('does not cover a thumbnail placed by hand when the site has one', async () => {
    respond(Buffer.from('jpeg'));
    const identity = await syncThumbnail(
      context(),
      params({ image: URL_V1, previous: null, currentKey: 'entity-thumbs/shot/12.jpg' }),
    );

    expect(openStream).not.toHaveBeenCalled();
    expect(setThumbnail).not.toHaveBeenCalled();
    // No marker either: the entity stays outside the synchronization's scope until someone removes the image chosen here.
    expect(identity).toBeNull();
  });

  it('fetches nothing when the studio has switched the setting off', async () => {
    const identity = await syncThumbnail(context(false), params({ previous: 'témoin-précédent' }));

    expect(openStream).not.toHaveBeenCalled();
    expect(identity).toBe('témoin-précédent');
  });

  /**
   * The type comes from the response of a remote service, and the key is then used to sign a URL served from the application's origin: nothing active enters there.
   */
  it('refuses a type that storage must not serve', async () => {
    respond(Buffer.from('<svg/>'), 'image/svg+xml');
    const identity = await syncThumbnail(context(), params());

    expect(putObject).not.toHaveBeenCalled();
    expect(identity).toBeNull();
  });

  it('refuses an image announced beyond the cap', async () => {
    respond(Buffer.from('jpeg'), 'image/jpeg', 11 * 1024 * 1024);
    await syncThumbnail(context(), params());

    expect(putObject).not.toHaveBeenCalled();
  });

  /**
   * A missing thumbnail impoverishes the display; it does not make the entity's import fail. The previous marker is kept so that the next pass retries.
   */
  it('keeps the previous marker when the download fails', async () => {
    openStream.mockRejectedValue(new Error('502'));
    const ctx = context();
    const identity = await syncThumbnail(
      ctx,
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(identity).toBe(thumbnailIdentity(URL_V1));
    expect(ctx.journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.thumbnailFailed',
      expect.objectContaining({ name: 'sh010' }),
      expect.anything(),
    );
  });

  /** A JPEG replaced by a PNG changes key: the old object is no longer designated by anything. */
  it('deletes the old object when the extension changes', async () => {
    respond(Buffer.from('png'), 'image/png');
    const identity = await syncThumbnail(
      context(),
      params({
        image: URL_V2,
        previous: thumbnailIdentity(URL_V1),
        currentKey: 'entity-thumbs/shot/12.jpg',
      }),
    );

    expect(putObject).toHaveBeenCalledWith('entity-thumbs/shot/12.png', expect.any(Buffer), 'image/png');
    expect(deleteObject).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
    // The marker only advances if the whole chain went through to the end.
    expect(identity).toBe(thumbnailIdentity(URL_V2));
  });
});
