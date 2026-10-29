// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSavedSplatEdits } from './useSavedSplatEdits';
import type { SplatEditProposal } from './splatEditPart';
import type { MediaResp, SplatEdits } from '../reviewTypes';
import type { SplatViewer } from './useSplat';

/**
 * Replays the cloud in read mode: the media's edits by default, and the proposal of the
 * selected comment when there is one (Phase 50, lot 14). This is what makes the proposal visible
 * to whoever reads the comment; without it, it would be only a blob in a column.
 *
 * The case that matters most is the last one: **editor mounted**. A manager is the only person able to
 * produce a proposal, and it was the only one for whom the replay was refused: two managers could not
 * read each other.
 */
const trs = (x: number) => ({
  position: [x, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

const savedEdits: SplatEdits = { transform: trs(1), volumes: [], baseFlip: true };
const proposal: SplatEditProposal = {
  transform: trs(9),
  volumes: [],
  baseFlip: false,
  maskUrl: null,
  subsetUrl: null,
  maskCount: 0,
  subsetCount: 0,
};

function viewer() {
  return {
    applyTransform: vi.fn(),
    setBaseFlip: vi.fn(),
    ready: true,
    // No scene handle: the effect of the volumes and mask shows straight away, and the test
    // stays on what it checks: which edit drives the cloud.
    getSceneHandle: () => null,
  } as unknown as SplatViewer;
}

const media = (edits: SplatEdits | null) =>
  ({ splatEdits: edits, splatMaskUrl: null, splatSubsetUrl: null }) as unknown as MediaResp;

describe('useSavedSplatEdits — what drives the cloud in reading', () => {
  it('replays the media edits when no comment is being read', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), false, null));
    expect(splat.applyTransform).toHaveBeenCalledWith(savedEdits.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(true);
  });

  it("replays the selected comment's proposal instead", () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), false, proposal));
    expect(splat.applyTransform).toHaveBeenCalledWith(proposal.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(false);
  });

  it('restores the media cloud as soon as the proposal is released', () => {
    const splat = viewer();
    const initialProps: { p: SplatEditProposal | null } = { p: proposal };
    const { rerender } = renderHook(
      ({ p }: { p: SplatEditProposal | null }) => useSavedSplatEdits(splat, media(savedEdits), false, p),
      { initialProps },
    );
    rerender({ p: null });
    expect(splat.applyTransform).toHaveBeenLastCalledWith(savedEdits.transform);
    expect(splat.setBaseFlip).toHaveBeenLastCalledWith(true);
  });

  it('touches nothing when the editor is mounted and no comment proposes', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), true, null));
    expect(splat.applyTransform).not.toHaveBeenCalled();
    expect(splat.setBaseFlip).not.toHaveBeenCalled();
  });

  /** The batch's defect: `showEdit` cut the replay for exactly those who produce the proposals. */
  it('replays the proposal EVEN with the editor mounted: a manager can read a manager', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), true, proposal));
    expect(splat.applyTransform).toHaveBeenCalledWith(proposal.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(false);
  });

  it('editor mounted: releasing the proposal does NOT reapply the media; the editor takes back', () => {
    const splat = viewer();
    const initialProps: { p: SplatEditProposal | null } = { p: proposal };
    const { rerender } = renderHook(
      ({ p }: { p: SplatEditProposal | null }) => useSavedSplatEdits(splat, media(savedEdits), true, p),
      { initialProps },
    );
    rerender({ p: null });
    // The last write stays that of the proposal: it is `useEditorSuspend` that then restores
    // the local TRS, not the media's saved edits.
    expect(splat.applyTransform).toHaveBeenLastCalledWith(proposal.transform);
  });
});
