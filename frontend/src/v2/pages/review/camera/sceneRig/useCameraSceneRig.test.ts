// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey } from '../channels/model';
import { strokeTime } from './useCameraSceneRig';

/**
 * The write time of a gizmo gesture. What must be locked down here is the reason for the visual
 * feedback: as soon as this time departs from the playhead, the scene shows something other than
 * what the gesture modifies — the rig therefore brings the head there (see `onDragging`).
 */

const anim = upsertKey(upsertKey(emptyAnim(), 'px', 0, 1), 'px', 2000, 5);

describe('strokeTime — where a gizmo gesture writes', () => {
  it('without a selection: at the playhead, rounded', () => {
    expect(strokeTime({ selection: [], anim, timeMs: 1234.6 })).toBe(1235);
  });

  it('with a key taken over: at that key\'s time, not at the playhead', () => {
    const t = strokeTime({ selection: [{ channel: 'px', index: 0 }], anim, timeMs: 1800 });
    expect(t).toBe(0);
    expect(t).not.toBe(1800); // this gap is what made the gesture invisible
  });

  it('"primary" key = the last of the multi-selection', () => {
    const selection = [
      { channel: 'px' as const, index: 1 },
      { channel: 'px' as const, index: 0 },
    ];
    expect(strokeTime({ selection, anim, timeMs: 900 })).toBe(0);
  });

  it('stale selection (key deleted): falls back to the playhead', () => {
    expect(strokeTime({ selection: [{ channel: 'py', index: 3 }], anim, timeMs: 700 })).toBe(700);
  });

  it('never a negative time', () => {
    expect(strokeTime({ selection: [], anim, timeMs: -50 })).toBe(0);
  });
});
