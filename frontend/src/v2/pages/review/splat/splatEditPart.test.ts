// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  buildSplatEditPart,
  hasSplatEditProposal,
  readSplatEditPart,
  resolveSplatEditProposal,
} from './splatEditPart';
import { IDENTITY_SPLAT_TRANSFORM, splitAnnotationParts, type SplatEdits } from '../reviewTypes';

/**
 * The cloud-edit proposal attached to a comment (Phase 50, lot 14): what it carries (the WHOLE
 * gesture, deletions included), the way the two binaries travel (by reference, like the images of
 * a point of interest), and the fact that it reads back exactly as it left.
 */
const trs = {
  position: [1, 0, -2] as [number, number, number],
  quaternion: [0, 0.7071, 0, 0.7071] as [number, number, number, number],
  scale: [1.5, 1.5, 1.5] as [number, number, number],
};
const volume = { shape: 'box', mode: 'delete', ...trs } as const;
const edits: SplatEdits = { transform: trs, volumes: [volume], baseFlip: false };
const MASK = 'comments/attachments/7/splat-mask.bin';
const SUBSET = 'comments/attachments/7/splat-subset.bin';
const refs = { mask: { key: MASK, count: 3 }, subset: { key: SUBSET, count: 1 } };

describe('buildSplatEditPart — what leaves with the comment', () => {
  it('carries the transform, the volumes and the flip', () => {
    expect(buildSplatEditPart(edits)).toEqual({ type: 'splat-edit', ...edits });
  });

  it('carries the references of the two binaries, never the binary itself', () => {
    const part = buildSplatEditPart(edits, refs)!;
    expect(part.mask).toEqual(refs.mask);
    expect(part.subset).toEqual(refs.subset);
    expect(Object.keys(part).sort()).toEqual(['baseFlip', 'mask', 'subset', 'transform', 'type', 'volumes']);
  });

  /**
   * The case missing from wave 1, and the most common gesture of the splat viewer: deleting splats
   * without moving anything. The proposal must exist: otherwise cleaning a cloud for others has no
   * address in a studio that publishes by default.
   */
  it('leaves for a clean-up alone: mask without transformation or volume', () => {
    const part = buildSplatEditPart(
      { transform: IDENTITY_SPLAT_TRANSFORM, volumes: [] },
      {
        mask: refs.mask,
      },
    )!;
    expect(part).toEqual({ type: 'splat-edit', transform: null, volumes: [], mask: refs.mask });
  });

  it('does not leave when nothing is proposed (empty edit or identity transform)', () => {
    expect(buildSplatEditPart(null)).toBeNull();
    expect(buildSplatEditPart({ transform: null, volumes: [] })).toBeNull();
    expect(
      buildSplatEditPart({ transform: IDENTITY_SPLAT_TRANSFORM, volumes: [], baseFlip: true }),
    ).toBeNull();
    // Empty references: nothing has been deposited, so nothing is announced.
    expect(buildSplatEditPart(null, { mask: null, subset: null })).toBeNull();
  });

  it('never copies an internal field of the editor', () => {
    const part = buildSplatEditPart({ ...edits, splatMaskKey: 'k', deleted: [1, 2] } as SplatEdits)!;
    expect(Object.keys(part).sort()).toEqual(['baseFlip', 'transform', 'type', 'volumes']);
  });
});

describe('hasSplatEditProposal — is there anything to attach?', () => {
  const draft = (over: Record<string, unknown>) =>
    ({
      edits: { transform: IDENTITY_SPLAT_TRANSFORM, volumes: [] },
      mask: null,
      subset: null,
      ...over,
    }) as never;

  it('yes as soon as a binary, a volume, a flip or a displacement exists', () => {
    expect(hasSplatEditProposal(draft({ mask: { bytes: new Uint8Array(2), count: 3 } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ subset: { bytes: new Uint8Array(8), count: 1 } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: null, volumes: [volume] } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: trs, volumes: [] } }))).toBe(true);
    expect(hasSplatEditProposal(draft({ edits: { transform: null, volumes: [], baseFlip: false } }))).toBe(
      true,
    );
  });

  it('no for a blank edit, or no edit at all', () => {
    expect(hasSplatEditProposal(null)).toBe(false);
    expect(hasSplatEditProposal(draft({}))).toBe(false);
  });
});

describe('readSplatEditPart — what is replayed on reading', () => {
  it('reads back exactly what left (round trip), binaries included', () => {
    const part = buildSplatEditPart(edits, refs)!;
    expect(readSplatEditPart([part])).toEqual({ ...edits, ...refs });
  });

  it('returns null when no part proposes an edit', () => {
    expect(readSplatEditPart([])).toBeNull();
    expect(readSplatEditPart([{ type: 'rect' }])).toBeNull();
    expect(readSplatEditPart([{ type: 'splat-edit' }])).toBeNull();
  });

  it('tolerates a damaged part rather than breaking the reading of the comment', () => {
    const broken = { type: 'splat-edit', transform: { position: [0, 0] }, volumes: [{ shape: 'blob' }] };
    expect(readSplatEditPart([broken as never])).toBeNull();
    const half = { type: 'splat-edit', transform: 'nope', volumes: [volume] };
    expect(readSplatEditPart([half as never])).toEqual({
      transform: null,
      volumes: [volume],
      mask: null,
      subset: null,
    });
    // Reference without a usable key: the rest of the proposal still replays.
    const noKey = { type: 'splat-edit', transform: trs, volumes: [], mask: { count: 3 } };
    expect(readSplatEditPart([noKey as never])?.mask).toBeNull();
  });
});

describe('resolveSplatEditProposal — the binaries are read only in the carrying comment', () => {
  const part = readSplatEditPart([buildSplatEditPart(edits, refs)!])!;

  it('resolves the presigned URLs of the attachments of the comment', () => {
    const resolved = resolveSplatEditProposal(part, [
      { key: MASK, url: 'https://minio/mask' },
      { key: SUBSET, url: 'https://minio/subset' },
    ]);
    expect(resolved).toEqual({
      ...edits,
      maskUrl: 'https://minio/mask',
      subsetUrl: 'https://minio/subset',
      maskCount: 3,
      subsetCount: 1,
    });
  });

  /**
   * The security guarantee: the key only serves as an INDEX among the attachments of the comment,
   * already filtered by prefix on the server side. A foreign key therefore gives nothing to load:
   * no URL is signed for it here.
   */
  it('gives no URL to a key absent from the attachments', () => {
    const resolved = resolveSplatEditProposal(part, [
      { key: 'comments/attachments/9/splat-mask.bin', url: 'https://minio/autrui' },
    ]);
    expect(resolved?.maskUrl).toBeNull();
    expect(resolved?.subsetUrl).toBeNull();
    expect(resolveSplatEditProposal(part, undefined)?.maskUrl).toBeNull();
  });

  it('no proposal ⇒ nothing to resolve', () => {
    expect(resolveSplatEditProposal(null, [])).toBeNull();
  });
});

describe('splitAnnotationParts — the part is not confused with a drawing', () => {
  it('extracts the proposal and excludes it from the 2D shapes', () => {
    const out = splitAnnotationParts([buildSplatEditPart(edits, refs)!, { type: 'rect', x: 0, y: 0 }]);
    expect(out.splatEdit).toEqual({ ...edits, ...refs });
    expect(out.shapes).toHaveLength(1);
    expect((out.shapes[0] as { type: string }).type).toBe('rect');
  });

  it('annotation absent or without proposal → null', () => {
    expect(splitAnnotationParts(null).splatEdit).toBeNull();
    expect(splitAnnotationParts([{ type: 'rect' }]).splatEdit).toBeNull();
  });
});
