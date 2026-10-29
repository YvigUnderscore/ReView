// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { applyHlsAuth, isApiUrl, isExpiredMediaUrlError } from './hlsSource';

const fakeXhr = () => ({ setRequestHeader: vi.fn() }) as unknown as XMLHttpRequest;

const APP = 'https://review.studio.test/review/9';

describe('hlsSource — scope of the session token', () => {
  it("recognizes API URLs, relative as well as absolute", () => {
    expect(isApiUrl('/api/media/9/hls/master.m3u8', APP)).toBe(true);
    // hls.js normalizes the source against location.href: xhrSetup receives absolute URLs.
    expect(isApiUrl('https://review.studio.test/api/media/9/hls/720p.m3u8?pt=abc', APP)).toBe(true);
  });

  it('does not recognize storage, even when served from the same origin (prod)', () => {
    expect(isApiUrl('https://review.studio.test/review/derived/9/hls/720p_000.ts?X-Amz=a', APP)).toBe(false);
    expect(isApiUrl('http://localhost:9000/review/derived/9/hls/720p_000.ts', APP)).toBe(false);
    expect(isApiUrl('https://elsewhere.test/api/media/9/hls/master.m3u8', APP)).toBe(false);
  });

  it("sets the authentication header on a manifest served by the API", () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, 'https://review.studio.test/api/media/9/hls/720p.m3u8?pt=abc', 'jeton', APP);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer jeton');
  });

  it('never hands the token to a presigned storage URL', () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, 'https://minio.test/review/derived/9/hls/720p_000.ts?X-Amz=a', 'jeton', APP);
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  it('sets nothing when the session is absent', () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, '/api/media/9/hls/master.m3u8', null, APP);
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  it("relies on the document origin when no base is provided", () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, '/api/media/9/hls/master.m3u8', 'jeton');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer jeton');
  });
});

describe('hlsSource — expiry of presigned URLs', () => {
  it('recognizes a fragment refused because its signature has expired', () => {
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 403 } })).toBe(true);
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 401 } })).toBe(true);
  });

  it('ignores other read errors (they have their own hls.js handling)', () => {
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 404 } })).toBe(false);
    expect(isExpiredMediaUrlError({ details: 'fragLoadTimeOut' })).toBe(false);
    expect(isExpiredMediaUrlError({ details: 'bufferStalledError' })).toBe(false);
    expect(isExpiredMediaUrlError({})).toBe(false);
  });
});
