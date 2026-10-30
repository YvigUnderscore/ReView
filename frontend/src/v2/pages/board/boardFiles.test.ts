// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import {
  MAX_INLINE_DATAURL,
  dataURLToBlob,
  filesToUpload,
  rehydrateFiles,
  storedIdsOf,
  toSavedDocument,
  type BoardFiles,
} from './boardFiles';

const big = (mimeType = 'image/png') => ({
  id: 'big',
  mimeType,
  dataURL: `data:${mimeType};base64,${'A'.repeat(MAX_INLINE_DATAURL)}`,
});
const small = { id: 'small', mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2Zy8+' };

describe('filesToUpload', () => {
  it('holds back images too heavy to stay in the document', () => {
    const files: BoardFiles = { big: big(), small };
    expect(filesToUpload(files, new Set()).map((f) => f.id)).toEqual(['big']);
  });

  it('does not re-upload an already stored image', () => {
    expect(filesToUpload({ big: big() }, new Set(['big']))).toEqual([]);
  });

  it('falls back an unknown type to the opaque type rather than blocking the save', () => {
    const exotic = { ...big('image/x-exotic'), id: 'big' };
    expect(filesToUpload({ big: exotic }, new Set())[0]?.mimeType).toBe('application/octet-stream');
  });

  it('ignores an entry without a dataURL (already externalised by another session)', () => {
    expect(filesToUpload({ f1: { id: 'f1', mimeType: 'image/png' } }, new Set())).toEqual([]);
  });
});

describe('toSavedDocument', () => {
  it('removes the dataURL of stored files and keeps small ones inline', () => {
    const doc = toSavedDocument([{ id: 'a', type: 'rectangle' }], { big: big(), small }, new Set(['big']));
    expect(doc.files.big).toEqual({ id: 'big', mimeType: 'image/png' });
    expect(doc.files.small?.dataURL).toBe(small.dataURL);
    expect(doc.elements).toHaveLength(1);
  });

  it('does not send `lastRetrieved`, an Excalidraw session metadata field', () => {
    const files: BoardFiles = { small: { ...small, created: 12, lastRetrieved: 99 } };
    expect(toSavedDocument([], files, new Set()).files.small).toEqual({
      id: 'small',
      mimeType: small.mimeType,
      created: 12,
      dataURL: small.dataURL,
    });
  });

  it('uses the key as identifier — the server requires them to match', () => {
    const doc = toSavedDocument([], { f1: { id: 'autre', mimeType: 'image/png' } }, new Set(['f1']));
    expect(doc.files.f1?.id).toBe('f1');
  });
});

describe('storedIdsOf', () => {
  it('recognises re-read files without a dataURL as stored', () => {
    const files: BoardFiles = { a: { id: 'a', mimeType: 'image/png' }, b: small };
    expect([...storedIdsOf(files)]).toEqual(['a']);
  });
});

describe('dataURLToBlob', () => {
  it('rebuilds the bytes and type of a base64 dataURL', async () => {
    // « hi » en base64.
    const blob = dataURLToBlob('data:image/png;base64,aGk=');
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('hi');
  });

  it('handles an unencoded dataURL', async () => {
    const blob = dataURLToBlob('data:image/svg+xml,%3Csvg%2F%3E');
    expect(await blob.text()).toBe('<svg/>');
  });
});

describe('rehydrateFiles', () => {
  const stored: BoardFiles = { f1: { id: 'f1', mimeType: 'image/png' } };

  it('returns a dataURL to Excalidraw, typed from the document and not from MinIO', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('hi').buffer),
    });
    const out = await rehydrateFiles(stored, { f1: 'https://minio/get/f1' }, fetcher as never);
    expect(fetcher).toHaveBeenCalledWith('https://minio/get/f1');
    expect(out.f1?.dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it('removes the entry if the image is not found, rather than returning a file without an image', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const out = await rehydrateFiles(stored, { f1: 'https://minio/get/f1' }, fetcher as never);
    expect(out.f1).toBeUndefined();
  });

  it('leaves intact a legacy board whose images are already base64', async () => {
    const legacy: BoardFiles = { small };
    expect(await rehydrateFiles(legacy, {})).toEqual(legacy);
  });
});
