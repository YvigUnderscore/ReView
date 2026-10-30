// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAnim, upsertKey, type CameraAnimV2, type KeyRef } from './channels/model';
import { isBroken, isWeighted } from './channels/tangents';
import { useCurveSelection } from './useCurveSelection';

const both: KeyRef[] = [
  { channel: 'px', index: 0 },
  { channel: 'px', index: 1 },
];

/** Mounts the hook with the animation and playhead that `useCameraAnim` would lend it. */
function setup(timeMs = 0) {
  const animRef = { current: upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 500, 50) };
  const timeRef = { current: timeMs };
  const commit = vi.fn((next: CameraAnimV2) => {
    animRef.current = next;
  });
  const { result } = renderHook(() => useCurveSelection({ animRef, timeRef, commit }));
  return { result, animRef, commit };
}

const times = (anim: CameraAnimV2) => (anim.channels.px?.keys ?? []).map((k) => k.t);
const modes = (anim: CameraAnimV2) => (anim.channels.px?.keys ?? []).map((k) => k.mode);

beforeEach(() => {
  localStorage.clear();
});

describe('useCurveSelection — selection', () => {
  it('remembers the selection and clears it on request', () => {
    const { result } = setup();
    expect(result.current.selection).toEqual([]);
    act(() => result.current.setSelection(both));
    expect(result.current.selection).toEqual(both);
    act(() => result.current.clearSelection());
    expect(result.current.selection).toEqual([]);
  });

  it('applies a tangent profile to all selected keys', () => {
    const { result, commit, animRef } = setup();
    act(() => result.current.setSelection(both));
    act(() => result.current.applyTangentType('linear'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(modes(animRef.current)).toEqual(['linear', 'linear']);
  });

  it('applies a profile to the targeted side only, which breaks the keys', () => {
    const { result, animRef } = setup();
    act(() => result.current.setSelection(both));
    act(() => result.current.applyTangentType('flat', 'out'));
    const keys = animRef.current.channels.px ?? { keys: [] };
    expect(keys.keys.map((k) => k.modeOut)).toEqual(['flat', 'flat']);
    expect(keys.keys.every(isBroken)).toBe(true);
  });

  it('breaks, unifies and weights the selection', () => {
    const { result, animRef } = setup();
    act(() => result.current.setSelection(both));
    act(() => result.current.setSelectionBroken(true));
    expect((animRef.current.channels.px?.keys ?? []).every(isBroken)).toBe(true);
    act(() => result.current.setSelectionBroken(false));
    expect((animRef.current.channels.px?.keys ?? []).some(isBroken)).toBe(false);
    act(() => result.current.setSelectionWeighted(true));
    expect((animRef.current.channels.px?.keys ?? []).every(isWeighted)).toBe(true);
  });

  it('deletes the selected keys and returns an empty selection', () => {
    const { result, commit, animRef } = setup();
    act(() => result.current.setSelection([{ channel: 'px', index: 0 }]));
    act(() => result.current.removeSelection());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(times(animRef.current)).toEqual([500]);
    expect(result.current.selection).toEqual([]);
  });

  it('without a selection, neither tangents nor deletion touch the animation', () => {
    const { result, commit } = setup();
    act(() => result.current.applyTangentType('step'));
    act(() => result.current.setSelectionBroken(true));
    act(() => result.current.setSelectionWeighted(true));
    act(() => result.current.removeSelection());
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('useCurveSelection — clipboard', () => {
  it('nothing to paste from an empty clipboard', () => {
    const { result, commit } = setup();
    act(() => result.current.paste());
    expect(result.current.canPaste).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('copies then pastes at the playhead, and selects the pasted keys', () => {
    const { result, commit, animRef } = setup(200);
    act(() => result.current.setSelection(both));
    act(() => result.current.copySelection());
    expect(result.current.canPaste).toBe(true);
    act(() => result.current.paste());
    expect(commit).toHaveBeenCalledTimes(1);
    // Times rebased on the earliest of the copy (0 and 500) then placed from 200 ms.
    expect(times(animRef.current)).toEqual([0, 200, 500, 700]);
    expect(result.current.selection).toEqual([
      { channel: 'px', index: 1 },
      { channel: 'px', index: 3 },
    ]);
  });

  it('copying with no selection yields nothing pasteable', () => {
    const { result } = setup();
    act(() => result.current.copySelection());
    expect(result.current.canPaste).toBe(false);
  });

  it('the clipboard survives unmounting: another media can paste', () => {
    const first = setup();
    act(() => first.result.current.setSelection([{ channel: 'px', index: 1 }]));
    act(() => first.result.current.copySelection());

    const second = setup(1000);
    expect(second.result.current.canPaste).toBe(true);
    act(() => second.result.current.paste());
    expect(times(second.animRef.current)).toEqual([0, 500, 1000]);
  });
});
