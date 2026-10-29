// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompareArm } from './useCompareArm';

/**
 * The link between the "Compare" segment of the toggle and the comparison state.
 *
 * The two lived side by side without talking to each other: clicking "Compare" opened no
 * comparison, and the wipe bar never appeared. What is checked here: the three rules and
 * their converses.
 */
type Props = Parameters<typeof useCompareArm>[0];

const spies = () => ({
  onMode: vi.fn(),
  onSetB: vi.fn(),
  onClear: vi.fn(),
  onCompareMode: vi.fn(),
});

const arm = (props: Partial<Props> & ReturnType<typeof spies>) => {
  const initial: Props = { mode: 'explore', hasB: false, firstB: null, ...props };
  const hook = renderHook((p: Props) => useCompareArm(p), { initialProps: initial });
  return { ...hook, initial };
};

describe('useCompareArm', () => {
  it('arming Compare sets the comparison mode to wipe', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    expect(s.onCompareMode).not.toHaveBeenCalled();
    rerender({ ...initial, mode: 'compare' });
    expect(s.onCompareMode).toHaveBeenCalledWith('wipe');
  });

  it('arming Compare without B takes the first comparable media, once only', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    // The neighbouring versions' details arrive later: the choice waits for `firstB`.
    rerender({ ...initial, mode: 'compare' });
    expect(s.onSetB).not.toHaveBeenCalled();
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledWith(42);
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledTimes(1);
  });

  it('leaving the mode closes the open comparison', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare', hasB: true });
    rerender({ ...initial, mode: 'explore', hasB: true });
    expect(s.onClear).toHaveBeenCalledTimes(1);
  });

  it('leaving the mode without a comparison closes nothing', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare' });
    rerender({ ...initial, mode: 'annotate' });
    expect(s.onClear).not.toHaveBeenCalled();
  });

  it('closing the comparison leaves the mode', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare', hasB: true });
    rerender({ ...initial, mode: 'compare', hasB: false });
    expect(s.onMode).toHaveBeenCalledWith('explore');
  });

  it('a B chosen elsewhere (video header, live session) arms the mode', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    rerender({ ...initial, hasB: true });
    expect(s.onMode).toHaveBeenCalledWith('compare');
  });

  it('does not force the wipe when it is B that armed the mode', () => {
    // The video that ticks two versions at once wants its 2×2 grid: switching to wipe on the
    // way would steal its display.
    const s = spies();
    const { rerender, initial } = arm(s);
    rerender({ ...initial, hasB: true });
    // What the parent does in response to `onMode('compare')`.
    rerender({ ...initial, hasB: true, mode: 'compare' });
    expect(s.onCompareMode).not.toHaveBeenCalled();
  });

  it('forces the wipe when the user arms the segment', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, hasB: true });
    rerender({ ...initial, hasB: true, mode: 'compare' });
    expect(s.onCompareMode).toHaveBeenCalledWith('wipe');
  });

  it('resumes from the first media after a close and a new arming', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, firstB: 42 });
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    rerender({ ...initial, mode: 'explore', firstB: 42 });
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledTimes(2);
  });
});
