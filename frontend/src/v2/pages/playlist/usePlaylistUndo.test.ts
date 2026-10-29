// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { itemOrderFor } from './usePlaylistUndo';

const item = (id: number, versionId: number) => ({ id, version: { id: versionId } });

describe('itemOrderFor', () => {
  it('puts items back in the order of the earlier versions, new identifier included', () => {
    // Version 20 was removed, then re-added: it comes back at the end of the list, as item 99.
    const items = [item(1, 10), item(3, 30), item(99, 20)];
    expect(itemOrderFor(items, [10, 20, 30])).toEqual([1, 99, 3]);
  });

  it('skips a version that is no longer there (removed in parallel) instead of failing', () => {
    const items = [item(1, 10), item(99, 20)];
    expect(itemOrderFor(items, [10, 20, 30])).toEqual([1, 99]);
  });

  it('returns an empty list when nothing of the earlier order remains', () => {
    expect(itemOrderFor([item(7, 70)], [10, 20])).toEqual([]);
  });
});
