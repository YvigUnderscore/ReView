// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { syncOutcome } from './syncOutcome';

describe('syncOutcome', () => {
  it("does not announce a finished pass when it is only queued", () => {
    // The original bug: "Sync complete" in green for a request that was waiting behind
    // a running pass. Neither the tone nor the message may say that.
    const outcome = syncOutcome('deferred');
    expect(outcome.tone).toBe('info');
    expect(outcome.key).toBe('shotgrid.sync.queued');
  });

  it('talks about the whole sync, not the re-read of one entity', () => {
    // The dot has its own phrase ("this re-read"): reusing it here would make the button
    // describe an action the user did not take.
    expect(syncOutcome('deferred').key).not.toBe('shotgrid.sync.dot.queued');
  });

  it('keeps red for a failure and green for a completed pass', () => {
    expect(syncOutcome('error')).toEqual({ tone: 'error', key: 'shotgrid.sync.failed' });
    expect(syncOutcome('ok')).toEqual({ tone: 'success', key: 'shotgrid.sync.done' });
  });

  it('falls back to "done" for a missing or unknown status', () => {
    // The pass did happen: only its detail escapes us. The opposite, a red by default,
    // would make a successful sync get run again.
    expect(syncOutcome(undefined).tone).toBe('success');
    expect(syncOutcome('partial').tone).toBe('success');
  });
});
