// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  getToken: vi.fn(() => 'jeton'),
  api: { post: vi.fn(), get: vi.fn() },
}));
// Only the network endpoint is simulated: the pool, retry and cancellation are the real code.
vi.mock('./uploadTransfer', async (original) => ({
  ...(await original<typeof import('./uploadTransfer')>()),
  putWithProgress: vi.fn(),
}));

import { uploadImageSequence } from './sequenceUpload';
import { detectSequences } from './imageSequence';
import { api } from './apiClient';
import { putWithProgress, UploadHttpError } from './uploadTransfer';

/**
 * Sending a sequence: N files, ONE media.
 *
 * Three things must hold, because each one costs a whole shot when it fails:
 * all the frames go out (not only the first batch), a resume skips what has
 * already arrived, and a cancellation frees the frames already dropped on the server side.
 */

const post = vi.mocked(api.post);
const put = vi.mocked(putWithProgress);

const sequenceOf = (from: number, to: number) => {
  const files = Array.from(
    { length: to - from + 1 },
    (_, i) => ({ name: `plan.${String(from + i).padStart(4, '0')}.exr`, size: 1000 }) as unknown as File,
  );
  return detectSequences(files).sequences[0];
};

/** Routes the sequence API; `uploadedFrames` simulates a resume. */
function routeApi(uploadedFrames: string[] = []) {
  const urlRequests: string[][] = [];
  post.mockImplementation((path: string, body?: unknown) => {
    if (path === '/api/media/sequence/init')
      return Promise.resolve({
        mediaObjectId: 7,
        resumed: uploadedFrames.length > 0,
        uploadedFrames,
      } as never);
    if (path === '/api/media/sequence/7/urls') {
      const names = (body as { names: string[] }).names;
      urlRequests.push(names);
      return Promise.resolve({ urls: names.map((n) => ({ name: n, url: `https://s3/${n}` })) } as never);
    }
    if (path === '/api/media/sequence/7/complete')
      return Promise.resolve({
        media: { id: 7, status: 'PROCESSING' },
        frameCount: 100,
        missingFrames: 0,
      } as never);
    return Promise.resolve({} as never);
  });
  return urlRequests;
}

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue(null);
});

describe('uploadImageSequence', () => {
  it('declares the pattern and all the frames to the server, as one media', async () => {
    routeApi();
    const res = await uploadImageSequence(sequenceOf(1001, 1010), 4);
    const init = post.mock.calls.find(([p]) => p === '/api/media/sequence/init')![1] as {
      pattern: string;
      frames: { name: string }[];
    };
    expect(init.pattern).toBe('plan.%04d.exr');
    expect(init.frames).toHaveLength(10);
    expect(res).toMatchObject({ mediaObjectId: 7, status: 'PROCESSING' });
  });

  it('carries the upload instruction to finalization, like a single file', async () => {
    routeApi();
    await uploadImageSequence(sequenceOf(1001, 1003), 4, { note: 'Comp v3, regarder le bord gauche' });
    const complete = post.mock.calls.find(([p]) => p === '/api/media/sequence/7/complete');
    expect(complete?.[1]).toEqual({ note: 'Comp v3, regarder le bord gauche' });
  });

  it('sends all the frames, in successive batches of URLs', async () => {
    const urlRequests = routeApi();
    await uploadImageSequence(sequenceOf(1001, 1100), 4);
    expect(put).toHaveBeenCalledTimes(100);
    // 100 frames in batches of 32: four URL requests, the last one partial.
    expect(urlRequests.map((r) => r.length)).toEqual([32, 32, 32, 4]);
  });

  it('resumes an interrupted upload without resending what has already arrived', async () => {
    routeApi(['plan.1001.exr', 'plan.1002.exr', 'plan.1003.exr']);
    await uploadImageSequence(sequenceOf(1001, 1010), 4);
    expect(put).toHaveBeenCalledTimes(7);
  });

  it('returns progress in bytes AND in files', async () => {
    routeApi();
    const seen: { percent: number; files: number; totalFiles: number }[] = [];
    await uploadImageSequence(sequenceOf(1001, 1004), 4, {
      onProgress: (p) => seen.push({ percent: p.percent, files: p.files, totalFiles: p.totalFiles }),
    });
    expect(seen[0]).toEqual({ percent: 0, files: 0, totalFiles: 4 });
    expect(seen.at(-1)).toMatchObject({ files: 4, totalFiles: 4 });
    // The percentage stays below 100 until the server finalization has responded.
    expect(Math.max(...seen.map((s) => s.percent))).toBeLessThanOrEqual(99);
  });

  it('frees the frames already dropped when the upload is cancelled', async () => {
    routeApi();
    const ctrl = new AbortController();
    put.mockImplementation(async () => {
      ctrl.abort();
      return null;
    });
    await expect(uploadImageSequence(sequenceOf(1001, 1010), 4, { signal: ctrl.signal })).rejects.toThrow();
    expect(post.mock.calls.some(([p]) => p === '/api/media/multipart/7/abort')).toBe(true);
    expect(post.mock.calls.some(([p]) => p === '/api/media/sequence/7/complete')).toBe(false);
  });

  it('does not finalize when a frame fails definitively', async () => {
    routeApi();
    // 400: definitive refusal, no retry: an incomplete batch must never be finalized.
    put.mockRejectedValue(new UploadHttpError(400));
    await expect(uploadImageSequence(sequenceOf(1001, 1010), 4)).rejects.toThrow();
    expect(post.mock.calls.some(([p]) => p === '/api/media/sequence/7/complete')).toBe(false);
  });
});
