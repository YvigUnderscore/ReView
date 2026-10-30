// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import SelectionBar from './selection-bar';

/**
 * The bar's removal, when framer-motion is no longer there to hold it.
 *
 * `AnimatePresence` kept the node mounted for the duration of the exit **and** froze what it
 * displayed. It is this second point that is lost without thinking: by the last frame the
 * page has already cleared the selection, and a naive bar would announce "0 selected" while it
 * slides back down. These cases lock both: it stays 180 ms, and it keeps announcing the last
 * real count.
 */

const ACTIONS = [{ label: 'Supprimer', onClick: () => {} }];

afterEach(() => {
  vi.useRealTimers();
});

describe('SelectionBar', () => {
  it('does not exist as long as nothing is selected', () => {
    render(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    expect(screen.queryByText('plans')).not.toBeInTheDocument();
  });

  it('slides up from the bottom on the first selection', () => {
    render(<SelectionBar count={3} actions={ACTIONS} onClear={() => {}} label="plans" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('plans').closest('div.fixed')).toHaveClass('animate-in');
  });

  it('stays mounted while sliding back down, keeping the last count displayed', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SelectionBar count={3} actions={ACTIONS} onClear={() => {}} label="plans" />,
    );

    // What the page does when the selection is emptied: the count drops to zero at once.
    act(() => {
      rerender(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });
    const bar = screen.getByText('plans').closest('div.fixed');
    expect(bar).toHaveClass('animate-out');
    // The freeze: "3", not "0".
    expect(screen.getByText('3')).toBeInTheDocument();

    // Just before the end of the animation, it is still there.
    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(screen.getByText('plans')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('plans')).not.toBeInTheDocument();
  });

  it('slides in again if a selection restarts before the removal ends', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SelectionBar count={2} actions={ACTIONS} onClear={() => {}} label="plans" />,
    );
    act(() => {
      rerender(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      rerender(<SelectionBar count={5} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });

    // The removal countdown was cancelled: past its term, the bar is still there.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('plans').closest('div.fixed')).toHaveClass('animate-in');
  });
});
