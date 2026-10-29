// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { MAX_SPLAT_EDIT_BLOB_BYTES, assertSplatEditBlobs, splatEditBlobKeys } from './commentSplatEdit';

/**
 * The two binaries of a cloud-edit proposal travel as attachments of the comment, and the part only
 * carries their key. This file holds the three guarantees that make that choice defensible: we know which
 * keys an annotation references (so the purge sees them), a reference outside the attachment list is
 * refused (so nothing leaks and nothing belongs to someone else), and the size ceiling is checked rather
 * than declared.
 */
const MASK = 'comments/attachments/7/splat-mask.bin';
const SUBSET = 'comments/attachments/7/splat-subset.bin';
const part = (over: Record<string, unknown> = {}) => [
  { type: 'splat-edit', transform: null, volumes: [], mask: { key: MASK, count: 3 }, ...over },
];

describe('splatEditBlobKeys — what the purge must see', () => {
  it('extracts the two keys of the part', () => {
    const keys = splatEditBlobKeys(part({ subset: { key: SUBSET, count: 1 } }));
    expect(keys.sort()).toEqual([MASK, SUBSET].sort());
  });

  it('returns nothing when there is no proposal, or no binary', () => {
    expect(splatEditBlobKeys(null)).toEqual([]);
    expect(splatEditBlobKeys([{ type: 'rect' }])).toEqual([]);
    expect(splatEditBlobKeys(part({ mask: null }))).toEqual([]);
  });

  it('assumes nothing about the shape: the column is free JSON', () => {
    expect(splatEditBlobKeys('nope')).toEqual([]);
    expect(splatEditBlobKeys([null, 42, { type: 'splat-edit', mask: 'AAAA' }])).toEqual([]);
    expect(splatEditBlobKeys(part({ mask: { count: 3 } }))).toEqual([]);
  });

  it('deduplicates: the same key cited twice is not purged twice', () => {
    expect(splatEditBlobKeys(part({ subset: { key: MASK, count: 1 } }))).toEqual([MASK]);
  });
});

describe('assertSplatEditBlobs — the reference must be an attachment, and fit', () => {
  const stat = (size: number) => vi.fn().mockResolvedValue({ size });

  it('lets through a proposal whose blob is attached and under the ceiling', async () => {
    const statObject = stat(1_000);
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: statObject }),
    ).resolves.toBeUndefined();
    expect(statObject).toHaveBeenCalledWith(MASK);
  });

  it('does not touch storage when there is nothing to check', async () => {
    const statObject = stat(1_000);
    await assertSplatEditBlobs([{ type: 'rect' }], { attachedKeys: [], stat: statObject });
    expect(statObject).not.toHaveBeenCalled();
  });

  /**
   * The refusal that closes two doors at once: a key that is not among the comment's attachments belongs
   * to no one safely (the list is prefix-filtered) and nothing would collect it on deletion.
   */
  it('refuses a reference that is not an attachment of the comment', async () => {
    await expect(assertSplatEditBlobs(part(), { attachedKeys: [], stat: stat(10) })).rejects.toMatchObject({
      statusCode: 400,
      code: 'SPLAT_EDIT_UNATTACHED',
    });
    await expect(
      assertSplatEditBlobs(part({ mask: { key: 'comments/attachments/9/splat-mask.bin', count: 3 } }), {
        attachedKeys: [MASK],
        stat: stat(10),
      }),
    ).rejects.toMatchObject({ code: 'SPLAT_EDIT_UNATTACHED' });
  });

  it('refuses a blob missing from storage', async () => {
    const missing = vi.fn().mockRejectedValue(new Error('404'));
    await expect(assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: missing })).rejects.toMatchObject(
      { statusCode: 400, code: 'SPLAT_EDIT_MISSING' },
    );
  });

  it('refuses a blob above the ceiling, and accepts the ceiling itself', async () => {
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: stat(MAX_SPLAT_EDIT_BLOB_BYTES + 1) }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SPLAT_EDIT_TOO_LARGE' });
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: stat(MAX_SPLAT_EDIT_BLOB_BYTES) }),
    ).resolves.toBeUndefined();
  });
});
