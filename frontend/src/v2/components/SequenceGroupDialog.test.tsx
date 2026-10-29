// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { accept, cancel } = vi.hoisted(() => ({ accept: vi.fn(), cancel: vi.fn() }));

import SequenceGroupDialog from './SequenceGroupDialog';
import { t } from '../i18n';
import { detectSequences } from '../../lib/imageSequence';
import { useSequenceUploadStore } from '../../stores/useSequenceUploadStore';

/**
 * The grouping proposal.
 *
 * This dialog is the only place where it is decided whether a thousand files become one media or
 * a thousand. What is verified: it shows what was recognized (pattern, bounds, gaps), it
 * goes out with everything grouped, and it offers a frank exit to file-by-file sending:
 * grouping must never be the only path.
 */

const file = (name: string, size = 1000): File => ({ name, size }) as unknown as File;
const plan = (from: number, to: number): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) => file(`plan.${String(from + i).padStart(4, '0')}.exr`));

const openWith = (files: File[]): void => {
  const { sequences, singles } = detectSequences(files);
  useSequenceUploadStore.setState({
    proposal: { sequences, singles, resolve: vi.fn() },
    uploads: [],
    acceptProposal: accept,
    cancelProposal: cancel,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  useSequenceUploadStore.setState({ proposal: null, uploads: [] });
});

describe('SequenceGroupDialog', () => {
  it('is not shown when no drop awaits a decision', () => {
    useSequenceUploadStore.setState({ proposal: null });
    const { container } = render(<SequenceGroupDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the recognized pattern and the bounds of the delivery', () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    expect(screen.getByText('plan.%04d.exr')).toBeTruthy();
  });

  it('goes out with everything grouped: that is by far the most frequent case', async () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute('data-state')).toBe('checked');

    // Labels are queried through `t()`, not copied: the test survives the addition of the
    // translation batch as well as a language change.
    await userEvent.click(screen.getByRole('button', { name: t('imageSequence.confirm') }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect((accept.mock.calls[0][0] as { pattern: string }[])[0].pattern).toBe('plan.%04d.exr');
  });

  it('lets everything be sent file by file', async () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    await userEvent.click(screen.getByRole('button', { name: t('imageSequence.sendSeparately') }));
    expect(accept).toHaveBeenCalledWith([]);
  });

  it('proposes two sequences separately when the drop contains two', () => {
    openWith([...plan(1001, 1005), file('autre.0001.dpx'), file('autre.0002.dpx')]);
    render(<SequenceGroupDialog />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
