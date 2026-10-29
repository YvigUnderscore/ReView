// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUploadStore } from './useUploadStore';
import { uploadMedia } from '../lib/uploadClient';

// The store delegates the network flow to uploadClient: it is fully simulated.
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
  it('enqueue → done: progress then mediaObjectId', async () => {
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

  it('enqueue → error: the failure message is kept', async () => {
    uploadMediaMock.mockRejectedValue(new Error('PUT 403'));
    const id = useUploadStore.getState().enqueue(file, 7);
    await flush();
    const u = useUploadStore.getState().uploads.find((x) => x.id === id)!;
    expect(u.status).toBe('error');
    expect(u.error).toBe('PUT 403');
  });

  it('activeCount counts only unfinished uploads', async () => {
    uploadMediaMock.mockResolvedValue({ mediaObjectId: 1, status: 'READY' });
    useUploadStore.getState().enqueue(file, 1);
    expect(useUploadStore.getState().activeCount()).toBe(1);
    await flush();
    expect(useUploadStore.getState().activeCount()).toBe(0);
  });

  it('clearCompleted removes only completed uploads', async () => {
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

/** Counts the items of a given status: the queue is read from this and nothing else. */
const count = (status: string) => useUploadStore.getState().uploads.filter((u) => u.status === status).length;

describe('useUploadStore — bounded queue', () => {
  it('launches only three transfers at once, the next ones wait for their slot', async () => {
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

    // A freed slot = one more transfer started, never two.
    expect(uploadMediaMock).toHaveBeenCalledTimes(4);
    expect(count('uploading')).toBe(3);
    expect(count('pending')).toBe(1);
  });

  it('removing a file still pending takes it out of the queue without ever sending it', async () => {
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
  it('removing a row really cuts the in-flight transfer', () => {
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

  it('a cancellation leaves no error row behind it', async () => {
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

  it('frees the slot taken by the cancelled transfer', async () => {
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
