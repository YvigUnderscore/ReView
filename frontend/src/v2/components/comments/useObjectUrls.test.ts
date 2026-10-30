// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useObjectUrls } from './useObjectUrls';

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    n += 1;
    const url = `blob:test/${n}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The thumbnail of a pending file lives in a `blob:` URL. Each one keeps its file in memory until
 * it is revoked: the hook must create one per file, and revoke all of them as soon as the list
 * changes or the composer goes away.
 */
describe('useObjectUrls', () => {
  it('creates one URL per file, in order', () => {
    const { result } = renderHook(() => useObjectUrls([png('a.png'), png('b.png')]));
    expect(created).toHaveLength(2);
    expect(result.current).toEqual(created);
  });

  it('revokes everything on unmount', () => {
    const { unmount } = renderHook(() => useObjectUrls([png('a.png')]));
    expect(revoked).toEqual([]);
    unmount();
    expect(revoked).toEqual(created);
  });

  it('revokes the previous batch when the list changes', () => {
    const { rerender } = renderHook(({ files }: { files: File[] }) => useObjectUrls(files), {
      initialProps: { files: [png('a.png')] },
    });
    const before = [...created];
    rerender({ files: [png('a.png'), png('b.png')] });
    expect(revoked).toEqual(before);
    expect(created).toHaveLength(3);
  });

  it('recreates nothing when the list keeps the same identity', () => {
    const files = [png('a.png')];
    const { rerender } = renderHook(({ f }: { f: File[] }) => useObjectUrls(f), {
      initialProps: { f: files },
    });
    rerender({ f: files });
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });
});
