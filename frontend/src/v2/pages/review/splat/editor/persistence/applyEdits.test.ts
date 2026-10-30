// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMaskIndices } from './applyEdits';
import { encodeMask } from './mask';

afterEach(() => vi.restoreAllMocks());

describe('fetchMaskIndices', () => {
  it('downloads and decodes the bitset into indices', async () => {
    const bytes = encodeMask([1, 8, 42]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0, bytes.byteLength)),
      }),
    );
    await expect(fetchMaskIndices('http://mask')).resolves.toEqual([1, 8, 42]);
  });

  it('rejects if the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchMaskIndices('http://mask')).rejects.toThrow('404');
  });
});
