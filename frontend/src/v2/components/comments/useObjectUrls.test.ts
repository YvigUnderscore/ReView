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
 * La vignette d'un fichier en attente vit dans une URL `blob:`. Chacune retient le fichier
 * en mémoire jusqu'à sa révocation : le hook doit en créer une par fichier, et les rendre
 * toutes dès que la liste change ou que le composeur disparaît.
 */
describe('useObjectUrls', () => {
  it('crée une URL par fichier, dans l’ordre', () => {
    const { result } = renderHook(() => useObjectUrls([png('a.png'), png('b.png')]));
    expect(created).toHaveLength(2);
    expect(result.current).toEqual(created);
  });

  it('révoque tout au démontage', () => {
    const { unmount } = renderHook(() => useObjectUrls([png('a.png')]));
    expect(revoked).toEqual([]);
    unmount();
    expect(revoked).toEqual(created);
  });

  it('révoque l’ancien lot quand la liste change', () => {
    const { rerender } = renderHook(({ files }: { files: File[] }) => useObjectUrls(files), {
      initialProps: { files: [png('a.png')] },
    });
    const before = [...created];
    rerender({ files: [png('a.png'), png('b.png')] });
    expect(revoked).toEqual(before);
    expect(created).toHaveLength(3);
  });

  it('ne recrée rien quand la liste ne change pas d’identité', () => {
    const files = [png('a.png')];
    const { rerender } = renderHook(({ f }: { f: File[] }) => useObjectUrls(f), {
      initialProps: { f: files },
    });
    rerender({ f: files });
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
  });
});
