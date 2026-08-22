// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { applyHlsAuth, isApiUrl, isExpiredMediaUrlError } from './hlsSource';

const fakeXhr = () => ({ setRequestHeader: vi.fn() }) as unknown as XMLHttpRequest;

const APP = 'https://review.studio.test/review/9';

describe('hlsSource — portée du jeton de session', () => {
  it("reconnaît les URL de l'API, relatives comme absolues", () => {
    expect(isApiUrl('/api/media/9/hls/master.m3u8', APP)).toBe(true);
    // hls.js normalise la source contre location.href : xhrSetup reçoit des URL absolues.
    expect(isApiUrl('https://review.studio.test/api/media/9/hls/720p.m3u8?pt=abc', APP)).toBe(true);
  });

  it('ne reconnaît pas le stockage, y compris servi sur la même origine (prod)', () => {
    expect(isApiUrl('https://review.studio.test/review/derived/9/hls/720p_000.ts?X-Amz=a', APP)).toBe(false);
    expect(isApiUrl('http://localhost:9000/review/derived/9/hls/720p_000.ts', APP)).toBe(false);
    expect(isApiUrl('https://ailleurs.test/api/media/9/hls/master.m3u8', APP)).toBe(false);
  });

  it("pose l'en-tête d'authentification sur un manifeste servi par l'API", () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, 'https://review.studio.test/api/media/9/hls/720p.m3u8?pt=abc', 'jeton', APP);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer jeton');
  });

  it('ne livre jamais le jeton à une URL présignée de stockage', () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, 'https://minio.test/review/derived/9/hls/720p_000.ts?X-Amz=a', 'jeton', APP);
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  it('ne pose rien quand la session est absente', () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, '/api/media/9/hls/master.m3u8', null, APP);
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  it("s'appuie sur l'origine du document quand aucune base n'est fournie", () => {
    const xhr = fakeXhr();
    applyHlsAuth(xhr, '/api/media/9/hls/master.m3u8', 'jeton');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer jeton');
  });
});

describe('hlsSource — péremption des URL présignées', () => {
  it('reconnaît un fragment refusé pour cause de signature expirée', () => {
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 403 } })).toBe(true);
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 401 } })).toBe(true);
  });

  it('ignore les autres erreurs de lecture (elles ont leur propre traitement hls.js)', () => {
    expect(isExpiredMediaUrlError({ details: 'fragLoadError', response: { code: 404 } })).toBe(false);
    expect(isExpiredMediaUrlError({ details: 'fragLoadTimeOut' })).toBe(false);
    expect(isExpiredMediaUrlError({ details: 'bufferStalledError' })).toBe(false);
    expect(isExpiredMediaUrlError({})).toBe(false);
  });
});
