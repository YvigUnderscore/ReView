// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('@/lib/apiClient', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));

import { isWebImage, presignAndUpload, putToPresignedUrl } from './presignedUpload';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  post.mockReset();
  fetchMock.mockReset();
});

describe('putToPresignedUrl', () => {
  it('PUTs the body with its content type, and no session header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const blob = new Blob(['x'], { type: 'image/png' });
    await putToPresignedUrl('https://s3/x', blob, 'nope');
    expect(fetchMock).toHaveBeenCalledWith('https://s3/x', {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('sends no content type when told so', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await putToPresignedUrl('https://s3/x', new Blob(['x']), 'nope', null);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: undefined });
  });

  it('throws the caller sentence when storage refuses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(putToPresignedUrl('https://s3/x', new Blob(['x']), 'Upload failed')).rejects.toThrow(
      'Upload failed',
    );
  });
});

describe('presignAndUpload', () => {
  it('presigns, uploads, and returns the presign response', async () => {
    post.mockResolvedValue({ url: 'https://s3/k', key: 'k', readUrl: 'https://read/k' });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const file = new File(['a'], 'a.png', { type: 'image/png' });
    const out = await presignAndUpload('/api/x/presign', { contentType: file.type }, file, 'nope');
    expect(post).toHaveBeenCalledWith('/api/x/presign', { contentType: 'image/png' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3/k',
      expect.objectContaining({ method: 'PUT', body: file }),
    );
    expect(out).toEqual({ url: 'https://s3/k', key: 'k', readUrl: 'https://read/k' });
  });

  it('does not upload when presigning fails', async () => {
    post.mockRejectedValue(new Error('403'));
    await expect(presignAndUpload('/api/x/presign', {}, new Blob(['a']), 'nope')).rejects.toThrow('403');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('isWebImage', () => {
  it('accepts png, jpeg, webp only', () => {
    expect(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].every(isWebImage)).toBe(true);
    expect(isWebImage('image/gif')).toBe(false);
    expect(isWebImage('image/svg+xml')).toBe(false);
  });
});
