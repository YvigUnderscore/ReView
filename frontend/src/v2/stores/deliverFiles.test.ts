// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { planDrop, sendPlan, withUploadNote } = vi.hoisted(() => ({
  planDrop: vi.fn(),
  sendPlan: vi.fn(),
  withUploadNote: vi.fn(),
}));

vi.mock('./useSequenceUploadStore', () => ({ planDrop, sendPlan }));
vi.mock('./useUploadNoteStore', () => ({ withUploadNote }));

import { deliverFiles } from './deliverFiles';

/**
 * The single entry point of a drop.
 *
 * What must hold: the order (grouping, then instruction, then target), and the fact that giving up
 * a dialog never touches the target: it is the target that creates the version, and an empty version
 * is precisely what an abandoned drop must not leave behind.
 */

const file = (name: string): File => ({ name, size: 1 }) as unknown as File;
const decided = { sequences: [], singles: [file('a.mov')] };

beforeEach(() => {
  vi.clearAllMocks();
  planDrop.mockResolvedValue(decided);
  // Project without a mandatory instruction: the gesture proceeds at once, without a message.
  withUploadNote.mockImplementation(async (_projectId: number, run: (note: string | null) => unknown) => {
    await run('Comp v3');
  });
});

describe('deliverFiles', () => {
  it('sends the chosen shot into the version the target designates, with the instruction', async () => {
    const target = vi.fn((send: (versionId: number) => void) => send(12));
    await deliverFiles(3, [file('a.mov')], target);
    expect(withUploadNote).toHaveBeenCalledWith(3, expect.any(Function));
    expect(sendPlan).toHaveBeenCalledWith(decided, 12, 'Comp v3');
  });

  it('does not touch the target when the grouping is abandoned', async () => {
    planDrop.mockResolvedValue(null);
    const target = vi.fn();
    await deliverFiles(3, [file('plan.1001.exr'), file('plan.1002.exr')], target);
    expect(withUploadNote).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
  });

  it('proposes the grouping BEFORE asking for the instruction', async () => {
    const order: string[] = [];
    planDrop.mockImplementation(() => {
      order.push('regroupement');
      return Promise.resolve(decided);
    });
    withUploadNote.mockImplementation(() => {
      order.push('consigne');
      return Promise.resolve();
    });
    await deliverFiles(3, [file('a.mov')], vi.fn());
    expect(order).toEqual(['regroupement', 'consigne']);
  });

  it('ignores an empty drop (folder without readable files)', async () => {
    const target = vi.fn();
    await deliverFiles(3, [], target);
    expect(planDrop).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
  });
});
