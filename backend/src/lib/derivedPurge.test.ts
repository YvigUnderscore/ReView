// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { selectObsoleteVersionIds, __testing } from './derivedPurge';

describe('selectObsoleteVersionIds', () => {
  it('keeps the N latest versions per task (descending id = most recent)', () => {
    const versions = [
      { id: 1, taskId: 10, assetId: null },
      { id: 2, taskId: 10, assetId: null },
      { id: 3, taskId: 10, assetId: null },
      { id: 4, taskId: 11, assetId: null },
    ];
    expect(selectObsoleteVersionIds(versions, 2).sort()).toEqual([1]);
    expect(selectObsoleteVersionIds(versions, 1).sort()).toEqual([1, 2]);
  });

  it('groups tasks and assets separately, never purging below the threshold', () => {
    const versions = [
      { id: 5, taskId: null, assetId: 7 },
      { id: 6, taskId: null, assetId: 7 },
      { id: 9, taskId: 3, assetId: null },
    ];
    expect(selectObsoleteVersionIds(versions, 2)).toEqual([]);
    expect(selectObsoleteVersionIds(versions, 1)).toEqual([5]);
  });

  it('orphan version (neither task nor asset) is never purged', () => {
    expect(selectObsoleteVersionIds([{ id: 1, taskId: null, assetId: null }], 1)).toEqual([]);
  });
});

describe('derivedPurge.sanitize', () => {
  const { sanitize, FALLBACK } = __testing;
  it('bounds keepVersions to [1, 100]', () => {
    expect(sanitize({ keepVersions: 0 }, FALLBACK).keepVersions).toBe(1);
    expect(sanitize({ keepVersions: 1000 }, FALLBACK).keepVersions).toBe(100);
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });
});
