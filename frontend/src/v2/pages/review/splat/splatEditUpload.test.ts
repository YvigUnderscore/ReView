// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { httpError, mockApi } from '../../../../test/apiMock';
import { MAX_SPLAT_EDIT_BLOB_BYTES, uploadSplatEditBlobs } from './splatEditUpload';
import type { SplatEditDraft } from './splatEditPart';

/**
 * Le dépôt des deux binaires d'une proposition. Ce qui est vérifié ici est ce qui coûte cher à
 * découvrir plus tard : qu'on ne téléverse RIEN quand il n'y a rien à téléverser, que les deux
 * refus se prennent avant la première requête, et que la part reçoit des clés — pas des octets.
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
 * Le PUT vers MinIO passe par le même `fetch` bouchonné que l'API : la route `PUT /put` est
 * donc le dépôt lui-même, et `called` compte les objets réellement déposés.
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

describe('uploadSplatEditBlobs — les binaires partent en pièces jointes', () => {
  it('dépose le masque et rend sa clé, son compte et sa pièce jointe', async () => {
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

  it('dépose les deux quand l’auteur a supprimé ET transformé un sous-ensemble', async () => {
    presign();
    const out = await uploadSplatEditBlobs(draft({ subset: { bytes: new Uint8Array(16), count: 1 } }), 0);
    expect(out.refs.mask).not.toBeNull();
    expect(out.refs.subset).not.toBeNull();
    expect(out.attachments).toHaveLength(2);
  });

  it('ne coûte aucune requête quand il n’y a rien à déposer', async () => {
    const calls = presign();
    const nothing = await uploadSplatEditBlobs(draft({ mask: null }), 0);
    expect(nothing).toEqual({ refs: { mask: null, subset: null }, attachments: [], dropped: null });
    expect(await uploadSplatEditBlobs(null, 0)).toEqual(nothing);
    expect(calls.calls).toHaveLength(0);
  });

  it('refuse un blob au-dessus du plafond, AVANT de téléverser', async () => {
    const calls = presign();
    const heavy = draft({ mask: { bytes: new Uint8Array(MAX_SPLAT_EDIT_BLOB_BYTES + 1), count: 9 } });
    const out = await uploadSplatEditBlobs(heavy, 0);
    expect(out.dropped).toBe('size');
    expect(out.refs.mask).toBeNull();
    expect(calls.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('refuse quand le commentaire n’a plus de place dans ses pièces jointes', async () => {
    const calls = presign();
    const out = await uploadSplatEditBlobs(draft({ subset: { bytes: new Uint8Array(8), count: 1 } }), 7);
    expect(out.dropped).toBe('room');
    expect(calls.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('remonte un échec de dépôt plutôt que d’annoncer une clé qui ne contient rien', async () => {
    presign(false);
    await expect(uploadSplatEditBlobs(draft(), 0)).rejects.toThrow();
  });
});
