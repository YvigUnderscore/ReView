// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  attachmentKeys,
  filterAttachments,
  orphanedKeys,
  ownAttachmentPrefix,
  shotgridAttachmentPrefix,
} from './commentAttachments';

describe('filterAttachments — the prefix guard', () => {
  const mine = ownAttachmentPrefix(7);
  const fromShotgrid = shotgridAttachmentPrefix(42);

  it('accepts the folder of its author', () => {
    const kept = filterAttachments([{ key: `${mine}1-a.png` }], [mine]);
    expect(kept).toHaveLength(1);
  });

  it("refuses another user's key", () => {
    expect(filterAttachments([{ key: 'comments/attachments/8/1-secret.png' }], [mine])).toEqual([]);
  });

  it('refuses a path traversal even under the right prefix', () => {
    expect(filterAttachments([{ key: `${mine}../8/1-secret.png` }], [mine])).toEqual([]);
  });

  it('keeps the files of the ShotGrid note of the comment being edited', () => {
    const kept = filterAttachments(
      [{ key: `${fromShotgrid}9-note.png` }, { key: `${mine}1-a.png` }],
      [mine, fromShotgrid],
    );
    expect(kept.map((a) => a.key)).toEqual([`${fromShotgrid}9-note.png`, `${mine}1-a.png`]);
  });

  it('refuses the ShotGrid folder of another comment', () => {
    const kept = filterAttachments(
      [{ key: `${shotgridAttachmentPrefix(43)}9-note.png` }],
      [mine, fromShotgrid],
    );
    expect(kept).toEqual([]);
  });

  it('tolerates an absent list', () => {
    expect(filterAttachments(undefined, [mine])).toEqual([]);
  });
});

describe('attachmentKeys / orphanedKeys', () => {
  it('ignores a JSON blob that is not a list of descriptors', () => {
    expect(attachmentKeys(null)).toEqual([]);
    expect(attachmentKeys('a.png')).toEqual([]);
    expect(attachmentKeys([{ name: 'a.png' }, 3, null])).toEqual([]);
  });

  it('reports the objects removed from the list', () => {
    const before = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    expect(orphanedKeys(before, [{ key: 'b' }])).toEqual(['a', 'c']);
  });

  it('returns all the keys when the list becomes empty', () => {
    expect(orphanedKeys([{ key: 'a' }], [])).toEqual(['a']);
    expect(orphanedKeys([{ key: 'a' }], null)).toEqual(['a']);
  });

  it('returns nothing when the list has not changed', () => {
    expect(orphanedKeys([{ key: 'a' }], [{ key: 'a' }])).toEqual([]);
  });

  it('deduplicates a repeated key before deleting it', () => {
    expect(orphanedKeys([{ key: 'a' }, { key: 'a' }], [])).toEqual(['a']);
  });
});
