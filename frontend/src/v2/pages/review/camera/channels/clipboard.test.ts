// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { CameraAnimV2 } from './model';
import { copyKeys, parseClipboard, pasteKeys } from './clipboard';

const anim: CameraAnimV2 = {
  version: 2,
  loop: true,
  channels: {
    px: {
      keys: [
        { t: 0, v: 1, mode: 'auto' },
        { t: 100, v: 2, mode: 'linear' },
        { t: 300, v: 5, mode: 'free', tin: 0.1, tout: 0.2 },
      ],
    },
    py: { keys: [{ t: 100, v: 9, mode: 'auto' }] },
  },
};

describe('clipboard — copy/paste keys (40.E)', () => {
  it('copies the selected keys with times relative to the earliest', () => {
    const clip = copyKeys(anim, [
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
      { channel: 'py', index: 0 },
    ]);
    expect(clip).not.toBeNull();
    // selected min t = 100 → rebased to 0.
    expect(clip!.channels.px).toEqual([
      { t: 0, v: 2, mode: 'linear' },
      { t: 200, v: 5, mode: 'free', tin: 0.1, tout: 0.2 },
    ]);
    expect(clip!.channels.py).toEqual([{ t: 0, v: 9, mode: 'auto' }]);
  });

  it('returns null if the selection references no key', () => {
    expect(copyKeys(anim, [])).toBeNull();
    expect(copyKeys(anim, [{ channel: 'pz', index: 0 }])).toBeNull();
  });

  it('pastes at the playhead preserving mode/tangents and selects the pasted keys', () => {
    const clip = copyKeys(anim, [
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
      { channel: 'py', index: 0 },
    ])!;
    const { anim: next, selection } = pasteKeys(anim, clip, 500);
    const px = next.channels.px!.keys;
    // Originals [0,100,300] + pasted [500,700].
    expect(px.map((k) => k.t)).toEqual([0, 100, 300, 500, 700]);
    expect(px[3]).toEqual({ t: 500, v: 2, mode: 'linear' });
    expect(px[4]).toEqual({ t: 700, v: 5, mode: 'free', tin: 0.1, tout: 0.2 });
    expect(next.channels.py!.keys.map((k) => k.t)).toEqual([100, 500]);
    expect(selection).toEqual([
      { channel: 'px', index: 3 },
      { channel: 'px', index: 4 },
      { channel: 'py', index: 1 },
    ]);
  });

  it('overwrites an existing key at the same time without duplicates', () => {
    const clip = copyKeys(anim, [{ channel: 'px', index: 1 }])!; // one key, relative t 0
    const { anim: next } = pasteKeys(anim, clip, 300); // t 300 already exists on px
    const px = next.channels.px!.keys;
    expect(px.map((k) => k.t)).toEqual([0, 100, 300]);
    expect(px[2].v).toBe(2); // replaced by the pasted key
  });

  it('validates/rejects a persisted shape (JSON round-trip)', () => {
    const clip = copyKeys(anim, [{ channel: 'px', index: 2 }])!;
    const roundTripped = parseClipboard(JSON.parse(JSON.stringify(clip)));
    expect(roundTripped).toEqual(clip);
    expect(parseClipboard(null)).toBeNull();
    expect(parseClipboard({ channels: {} })).toBeNull();
    expect(parseClipboard({ channels: { px: [{ t: 'x', v: 1, mode: 'auto' }] } })).toBeNull();
  });

  it('the re-reader keeps the tangent sides, the break and the weights', () => {
    // In-memory pasting already kept them: otherwise a round trip through storage returned a
    // stripped-down key, hence a different curve from one media to another.
    const rich = {
      channels: {
        px: [
          {
            t: 0,
            v: 1,
            mode: 'free',
            modeIn: 'flat',
            modeOut: 'free',
            broken: true,
            tin: 0,
            tout: 0.4,
            wIn: 1,
            wOut: 9,
          },
        ],
      },
    };
    const parsed = parseClipboard(rich);
    expect(parsed?.channels.px?.[0]).toEqual({
      t: 0,
      v: 1,
      mode: 'free',
      modeIn: 'flat',
      modeOut: 'free',
      broken: true,
      tin: 0,
      tout: 0.4,
      wIn: 1,
      // Out-of-range weight: brought back to the readable maximum rather than copied as is.
      wOut: 1.5,
    });
    expect(
      parseClipboard({ channels: { px: [{ t: 0, v: 1, mode: 'free', modeIn: 'wobble' }] } })?.channels.px?.[0]
        .modeIn,
    ).toBeUndefined();
  });
});
