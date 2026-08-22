// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUploadStore } from './useUploadStore';
import { uploadMedia } from '../lib/uploadClient';

// Le store délègue le flux réseau à uploadClient : on le simule intégralement.
vi.mock('../lib/uploadClient', () => ({
  uploadMedia: vi.fn(),
  inferMediaKind: () => 'IMAGE' as const,
}));
const uploadMediaMock = vi.mocked(uploadMedia);

const flush = () => new Promise((r) => setTimeout(r, 0));
const file = new File(['x'], 'plan.png', { type: 'image/png' });

beforeEach(() => {
  uploadMediaMock.mockReset();
  useUploadStore.setState({ uploads: [] });
});

describe('useUploadStore', () => {
  it('enqueue → done : progression puis mediaObjectId', async () => {
    uploadMediaMock.mockImplementation(async (_f, _v, opts) => {
      opts?.onProgress?.(50);
      opts?.onProgress?.(100);
      return { mediaObjectId: 42, status: 'READY' };
    });
    const id = useUploadStore.getState().enqueue(file, 7);
    expect(useUploadStore.getState().uploads).toHaveLength(1);
    await flush();
    const u = useUploadStore.getState().uploads.find((x) => x.id === id)!;
    expect(u.status).toBe('done');
    expect(u.progress).toBe(100);
    expect(u.mediaObjectId).toBe(42);
    expect(u.versionId).toBe(7);
  });

  it('enqueue → error : le message d’échec est conservé', async () => {
    uploadMediaMock.mockRejectedValue(new Error('PUT 403'));
    const id = useUploadStore.getState().enqueue(file, 7);
    await flush();
    const u = useUploadStore.getState().uploads.find((x) => x.id === id)!;
    expect(u.status).toBe('error');
    expect(u.error).toBe('PUT 403');
  });

  it('activeCount ne compte que les uploads non terminés', async () => {
    uploadMediaMock.mockResolvedValue({ mediaObjectId: 1, status: 'READY' });
    useUploadStore.getState().enqueue(file, 1);
    expect(useUploadStore.getState().activeCount()).toBe(1);
    await flush();
    expect(useUploadStore.getState().activeCount()).toBe(0);
  });

  it('clearCompleted retire uniquement les uploads terminés', async () => {
    uploadMediaMock.mockResolvedValueOnce({ mediaObjectId: 1, status: 'READY' });
    uploadMediaMock.mockRejectedValueOnce(new Error('boom'));
    useUploadStore.getState().enqueue(file, 1);
    useUploadStore.getState().enqueue(file, 2);
    await flush();
    useUploadStore.getState().clearCompleted();
    const statuses = useUploadStore.getState().uploads.map((u) => u.status);
    expect(statuses).toEqual(['error']);
  });
});

/** Compte les items d'un statut donné — la file se lit à ça et rien d'autre. */
const count = (status: string) => useUploadStore.getState().uploads.filter((u) => u.status === status).length;

describe('useUploadStore — file bornée', () => {
  it('ne lance que trois transferts de front, les suivants attendent leur créneau', async () => {
    const gates: (() => void)[] = [];
    uploadMediaMock.mockImplementation(
      () => new Promise((resolve) => gates.push(() => resolve({ mediaObjectId: 1, status: 'READY' }))),
    );

    for (let i = 0; i < 5; i++) useUploadStore.getState().enqueue(file, 1);

    expect(count('uploading')).toBe(3);
    expect(count('pending')).toBe(2);
    expect(uploadMediaMock).toHaveBeenCalledTimes(3);

    gates.shift()!();
    await flush();

    // Un créneau libéré = un transfert de plus démarré, jamais deux.
    expect(uploadMediaMock).toHaveBeenCalledTimes(4);
    expect(count('uploading')).toBe(3);
    expect(count('pending')).toBe(1);
  });

  it('retirer un fichier encore en attente le sort de la file sans jamais l’envoyer', async () => {
    const gates: (() => void)[] = [];
    uploadMediaMock.mockImplementation(
      () => new Promise((resolve) => gates.push(() => resolve({ mediaObjectId: 1, status: 'READY' }))),
    );
    const ids = Array.from({ length: 4 }, () => useUploadStore.getState().enqueue(file, 1));
    const waiting = useUploadStore.getState().uploads.find((u) => u.status === 'pending')!;
    expect(ids).toContain(waiting.id);

    useUploadStore.getState().removeUpload(waiting.id);
    gates.shift()!();
    await flush();

    expect(uploadMediaMock).toHaveBeenCalledTimes(3);
    expect(useUploadStore.getState().uploads).toHaveLength(3);
  });
});

describe('useUploadStore — annulation', () => {
  it('retirer une ligne coupe réellement le transfert en vol', () => {
    let signal: AbortSignal | undefined;
    uploadMediaMock.mockImplementation((_f, _v, opts) => {
      signal = opts?.signal;
      return new Promise(() => {}); // transfert qui ne se termine jamais tout seul
    });

    const id = useUploadStore.getState().enqueue(file, 1);
    expect(signal?.aborted).toBe(false);

    useUploadStore.getState().removeUpload(id);

    expect(signal?.aborted).toBe(true);
    expect(useUploadStore.getState().uploads).toHaveLength(0);
  });

  it('une annulation ne laisse pas de ligne en erreur derrière elle', async () => {
    uploadMediaMock.mockImplementation(
      (_f, _v, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('coupé')));
        }),
    );

    const id = useUploadStore.getState().enqueue(file, 1);
    useUploadStore.getState().removeUpload(id);
    await flush();

    expect(useUploadStore.getState().uploads).toEqual([]);
  });

  it('libère le créneau pris par le transfert annulé', async () => {
    uploadMediaMock.mockImplementation(
      (_f, _v, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('coupé')));
        }),
    );
    const ids = Array.from({ length: 4 }, () => useUploadStore.getState().enqueue(file, 1));

    useUploadStore.getState().removeUpload(ids[0]);
    await flush();

    expect(uploadMediaMock).toHaveBeenCalledTimes(4);
    expect(count('uploading')).toBe(3);
  });
});
