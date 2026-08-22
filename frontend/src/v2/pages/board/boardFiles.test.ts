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
  it('retient les images trop lourdes pour rester dans le document', () => {
    const files: BoardFiles = { big: big(), small };
    expect(filesToUpload(files, new Set()).map((f) => f.id)).toEqual(['big']);
  });

  it('ne redépose pas une image déjà stockée', () => {
    expect(filesToUpload({ big: big() }, new Set(['big']))).toEqual([]);
  });

  it('ramène un type inconnu au type opaque plutôt que de bloquer la sauvegarde', () => {
    const exotic = { ...big('image/x-exotic'), id: 'big' };
    expect(filesToUpload({ big: exotic }, new Set())[0]?.mimeType).toBe('application/octet-stream');
  });

  it('ignore une entrée sans dataURL (déjà externalisée par une autre session)', () => {
    expect(filesToUpload({ f1: { id: 'f1', mimeType: 'image/png' } }, new Set())).toEqual([]);
  });
});

describe('toSavedDocument', () => {
  it('retire la dataURL des fichiers stockés et garde les petits inline', () => {
    const doc = toSavedDocument([{ id: 'a', type: 'rectangle' }], { big: big(), small }, new Set(['big']));
    expect(doc.files.big).toEqual({ id: 'big', mimeType: 'image/png' });
    expect(doc.files.small?.dataURL).toBe(small.dataURL);
    expect(doc.elements).toHaveLength(1);
  });

  it('n’envoie pas `lastRetrieved`, métadonnée de session d’Excalidraw', () => {
    const files: BoardFiles = { small: { ...small, created: 12, lastRetrieved: 99 } };
    expect(toSavedDocument([], files, new Set()).files.small).toEqual({
      id: 'small',
      mimeType: small.mimeType,
      created: 12,
      dataURL: small.dataURL,
    });
  });

  it('reprend la clé comme identifiant — le serveur exige qu’ils coïncident', () => {
    const doc = toSavedDocument([], { f1: { id: 'autre', mimeType: 'image/png' } }, new Set(['f1']));
    expect(doc.files.f1?.id).toBe('f1');
  });
});

describe('storedIdsOf', () => {
  it('reconnaît comme stockés les fichiers relus sans dataURL', () => {
    const files: BoardFiles = { a: { id: 'a', mimeType: 'image/png' }, b: small };
    expect([...storedIdsOf(files)]).toEqual(['a']);
  });
});

describe('dataURLToBlob', () => {
  it('reconstitue les octets et le type d’une dataURL base64', async () => {
    // « hi » en base64.
    const blob = dataURLToBlob('data:image/png;base64,aGk=');
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('hi');
  });

  it('gère une dataURL non encodée', async () => {
    const blob = dataURLToBlob('data:image/svg+xml,%3Csvg%2F%3E');
    expect(await blob.text()).toBe('<svg/>');
  });
});

describe('rehydrateFiles', () => {
  const stored: BoardFiles = { f1: { id: 'f1', mimeType: 'image/png' } };

  it('rend à Excalidraw une dataURL, typée d’après le document et non d’après MinIO', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('hi').buffer),
    });
    const out = await rehydrateFiles(stored, { f1: 'https://minio/get/f1' }, fetcher as never);
    expect(fetcher).toHaveBeenCalledWith('https://minio/get/f1');
    expect(out.f1?.dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it('retire l’entrée si l’image est introuvable, au lieu de rendre un fichier sans image', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const out = await rehydrateFiles(stored, { f1: 'https://minio/get/f1' }, fetcher as never);
    expect(out.f1).toBeUndefined();
  });

  it('laisse intact un board legacy dont les images sont déjà en base64', async () => {
    const legacy: BoardFiles = { small };
    expect(await rehydrateFiles(legacy, {})).toEqual(legacy);
  });
});
