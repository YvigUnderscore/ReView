// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { enqueue, upload, toasts } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  upload: vi.fn(),
  toasts: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: toasts }));
vi.mock('./useUploadStore', () => ({ useUploadStore: { getState: () => ({ enqueue }) } }));
vi.mock('../lib/sequenceUpload', () => ({ uploadImageSequence: upload }));
vi.mock('../lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { planDrop, sendPlan, useSequenceUploadStore } from './useSequenceUploadStore';

/**
 * The entry point of a drop.
 *
 * The batch rule is what matters: **propose, never impose**. Nothing goes out until the
 * user has decided, and a drop with no recognized pattern must neither open a dialog nor change
 * anything about the previous behaviour. The decision hands control back
 * to the drop (`planDrop`), which only sends afterwards (`sendPlan`): this is what lets the
 * version be created only once the dialog is settled.
 */

const file = (name: string, size = 1000): File => ({ name, size }) as unknown as File;
const plan = (from: number, to: number): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) => file(`plan.${String(from + i).padStart(4, '0')}.exr`));

const reset = (): void => {
  useSequenceUploadStore.setState({ proposal: null, uploads: [] });
};

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  upload.mockResolvedValue({ mediaObjectId: 7, status: 'PROCESSING', frameCount: 10, missingFrames: 0 });
});

/** Opens the proposal and returns the drop's promise, still pending. */
const propose = (files: File[]) => {
  const pending = planDrop(files);
  return { pending, proposal: useSequenceUploadStore.getState().proposal };
};

describe('planDrop', () => {
  it('returns the drop as is, without a dialog, when no pattern is recognized', async () => {
    const files = [file('plan.mov'), file('brief.pdf')];
    await expect(planDrop(files)).resolves.toEqual({ sequences: [], singles: files });
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
  });

  it('opens the proposal and sends NOTHING until the user has decided', () => {
    const { proposal } = propose([...plan(1001, 1010), file('notes.txt')]);
    expect(proposal?.sequences.map((s) => s.pattern)).toEqual(['plan.%04d.exr']);
    expect(proposal?.singles.map((s) => s.name)).toEqual(['notes.txt']);
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('explicitly abandons a drop still pending when another one arrives', async () => {
    const first = propose(plan(1001, 1010));
    propose(plan(2001, 2005));
    await expect(first.pending).resolves.toBeNull();
    expect(useSequenceUploadStore.getState().proposal?.sequences[0].startFrame).toBe(2001);
  });
});

describe('acceptProposal', () => {
  it('returns the chosen sequence, and the rest as files', async () => {
    const { pending, proposal } = propose([...plan(1001, 1010), file('notes.txt')]);
    useSequenceUploadStore.getState().acceptProposal(proposal!.sequences);
    const decided = await pending;
    expect(decided?.sequences.map((s) => s.pattern)).toEqual(['plan.%04d.exr']);
    expect(decided?.singles.map((f) => f.name)).toEqual(['notes.txt']);
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
  });

  it('returns its frames as isolated files when the sequence is refused', async () => {
    const { pending } = propose(plan(1001, 1010));
    useSequenceUploadStore.getState().acceptProposal([]);
    const decided = await pending;
    expect(decided?.sequences).toEqual([]);
    expect(decided?.singles).toHaveLength(10);
  });
});

describe('cancelProposal', () => {
  it('closes without sending anything, and the drop learns it has been abandoned', async () => {
    const { pending } = propose(plan(1001, 1010));
    useSequenceUploadStore.getState().cancelProposal();
    await expect(pending).resolves.toBeNull();
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('sendPlan', () => {
  const sequenceOf = (files: File[]) => {
    const { pending, proposal } = propose(files);
    useSequenceUploadStore.getState().acceptProposal(proposal!.sequences);
    return pending.then((p) => p!);
  };

  it('sends the sequence as ONE media and the isolated files in the ordinary queue', async () => {
    sendPlan(await sequenceOf([...plan(1001, 1010), file('notes.txt')]), 4, 'Comp v3');
    expect(useSequenceUploadStore.getState().uploads).toHaveLength(1);
    expect(useSequenceUploadStore.getState().uploads[0]).toMatchObject({
      pattern: 'plan.%04d.exr',
      totalFrames: 10,
      versionId: 4,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }), 4, {
      note: 'Comp v3',
    });
  });

  it('carries the instruction through to the sending of the sequence', async () => {
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, 'Comp v3');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'plan.%04d.exr' }),
      4,
      expect.objectContaining({ note: 'Comp v3' }),
    );
  });

  it('flags a gappy delivery rather than letting it through silently', async () => {
    upload.mockResolvedValue({ mediaObjectId: 7, status: 'PROCESSING', frameCount: 9, missingFrames: 1 });
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, null);
    await vi.waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1));
    expect(useSequenceUploadStore.getState().uploads[0].status).toBe('processing');
  });

  it('surfaces the failure without erasing the row: the artist must see what went wrong', async () => {
    upload.mockRejectedValue(new Error('403'));
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, null);
    await vi.waitFor(() => expect(useSequenceUploadStore.getState().uploads[0].status).toBe('error'));
  });
});
