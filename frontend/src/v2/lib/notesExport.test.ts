// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiClient', () => ({ getToken: () => 'jeton' }));

import { downloadNotes, notesExportPath } from './notesExport';

/**
 * Downloading an export: the route called, the token carried (a navigation would not carry it),
 * the file name retained and the truncation warning relayed.
 */

const clicks: Array<{ href: string; download: string }> = [];
let created = 0;
let revoked = 0;

const response = (over: Partial<{ ok: boolean; headers: Record<string, string>; body: unknown }> = {}) => {
  const headers = new Headers(over.headers ?? {});
  return {
    ok: over.ok ?? true,
    headers,
    blob: () => Promise.resolve(new Blob(['note_id\n12'])),
    json: () => Promise.resolve(over.body ?? {}),
  } as unknown as Response;
};

beforeEach(() => {
  clicks.length = 0;
  created = 0;
  revoked = 0;
  URL.createObjectURL = vi.fn(() => {
    created += 1;
    return `blob:${created}`;
  });
  URL.revokeObjectURL = vi.fn(() => {
    revoked += 1;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => vi.restoreAllMocks());

describe('notesExportPath', () => {
  it('builds the route for the requested scope', () => {
    expect(notesExportPath({ scope: 'playlist', id: 3, format: 'otio' })).toBe(
      '/api/comments/export?scope=playlist&id=3&format=otio',
    );
  });
});

describe('downloadNotes', () => {
  it('calls the route with the token and triggers the download', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ headers: { 'content-disposition': 'attachment; filename="notes-media-7.csv"' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await downloadNotes({ scope: 'media', id: 7, format: 'csv' });
    expect(fetchMock).toHaveBeenCalledWith('/api/comments/export?scope=media&id=7&format=csv', {
      headers: { Authorization: 'Bearer jeton' },
    });
    expect(result).toEqual({ filename: 'notes-media-7.csv', truncated: false });
    expect(clicks).toEqual([{ href: 'blob:1', download: 'notes-media-7.csv' }]);
  });

  it('builds a file name when the server does not announce one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const result = await downloadNotes({ scope: 'shot', id: 42, format: 'sheet' });
    expect(result.filename).toBe('notes-shot-42.html');
    expect(clicks[0]?.download).toBe('notes-shot-42.html');
  });

  it('relays the truncation warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ headers: { 'x-notes-truncated': '1' } })));
    expect((await downloadNotes({ scope: 'media', id: 7, format: 'csv' })).truncated).toBe(true);
  });

  it('surfaces the server error message without downloading anything', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, body: { error: 'No access to this project' } })),
    );
    await expect(downloadNotes({ scope: 'media', id: 7, format: 'csv' })).rejects.toThrow(
      'No access to this project',
    );
    expect(clicks).toHaveLength(0);
  });

  it('releases the object URL once the click has gone through', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await downloadNotes({ scope: 'media', id: 7, format: 'csv' });
    expect(revoked).toBe(0);
    vi.runAllTimers();
    expect(revoked).toBe(1);
    vi.useRealTimers();
  });
});
