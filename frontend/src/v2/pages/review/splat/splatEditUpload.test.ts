// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { httpError, mockApi } from '../../../../test/apiMock';
import { MAX_SPLAT_EDIT_BLOB_BYTES, uploadSplatEditBlobs } from './splatEditUpload';
import type { SplatEditDraft } from './splatEditPart';

/**
 * The upload of the two binaries of a proposal. What is checked here is what is expensive to
 * discover later: that NOTHING is uploaded when there is nothing to upload, that the two refusals
 * are taken before the first request, and that the part receives keys, not bytes.
 */
const draft = (over: Partial<SplatEditDraft> = {}): SplatEditDraft => ({
  edits: { transform: null, volumes: [] },
  mask: { bytes: new Uint8Array([1, 2, 3]), count: 3 },
  subset: null,
  ...over,
});

let api: ReturnType<typeof mockApi> | null = null;
afterEach(() => {
  api?.restore();
  api = null;
});

/**
 * The PUT to MinIO goes through the same stubbed `fetch` as the API: the `PUT /put` route is
 * therefore the upload itself, and `called` counts the objects actually deposited.
 */
function presign(ok = true) {
  api = mockApi({
    'POST /api/comments/attachments/presign': ({ body }) => ({
      url: 'https://minio/put',
      key: 'comments/attachments/7/' + (body as { filename: string }).filename,
    }),
    'PUT /put': ok ? {} : httpError(500, 'nope'),
  });
  return api;
}

describe('uploadSplatEditBlobs — the binaries go as attachments', () => {
  it('deposits the mask and returns its key, count and attachment', async () => {
    const calls = presign();
    const out = await uploadSplatEditBlobs(draft(), 0);
    const key = 'comments/attachments/7/splat-mask.bin';
    expect(out.refs.mask).toEqual({ key, count: 3 });
    expect(out.refs.subset).toBeNull();
    expect(out.attachments).toEqual([
      { key, name: 'splat-mask.bin', contentType: 'application/octet-stream' },
    ]);
    expect(out.dropped).toBeNull();
    expect(calls.called('POST /api/comments/attachments/presign')).toHaveLength(1);
    expect(calls.called('PUT /put')).toHaveLength(1);
  });

  it('deposits both when the author deleted AND transformed a subset', async () => {
    presign();
    const out = await uploadSplatEditBlobs(draft({ subset: { bytes: new Uint8Array(16), count: 1 } }), 0);
    expect(out.refs.mask).not.toBeNull();
    expect(out.refs.subset).not.toBeNull();
    expect(out.attachments).toHaveLength(2);
  });

  it('costs no request when there is nothing to deposit', async () => {
    const calls = presign();
    const nothing = await uploadSplatEditBlobs(draft({ mask: null }), 0);
    expect(nothing).toEqual({ refs: { mask: null, subset: null }, attachments: [], dropped: null });
    expect(await uploadSplatEditBlobs(null, 0)).toEqual(nothing);
    expect(calls.calls).toHaveLength(0);
  });

  it('refuses a blob above the cap, BEFORE uploading', async () => {
    const calls = presign();
    const heavy = draft({ mask: { bytes: new Uint8Array(MAX_SPLAT_EDIT_BLOB_BYTES + 1), count: 9 } });
    const out = await uploadSplatEditBlobs(heavy, 0);
    expect(out.dropped).toBe('size');
    expect(out.refs.mask).toBeNull();
    expect(calls.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('refuses when the comment no longer has room in its attachments', async () => {
    const calls = presign();
    const out = await uploadSplatEditBlobs(draft({ subset: { bytes: new Uint8Array(8), count: 1 } }), 7);
    expect(out.dropped).toBe('room');
    expect(calls.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('reports a deposit failure rather than announcing a key that contains nothing', async () => {
    presign(false);
    await expect(uploadSplatEditBlobs(draft(), 0)).rejects.toThrow();
  });
});
