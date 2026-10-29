// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BLENDER_THUMB_MARKER,
  BLENDER_THUMB_TIMEOUT_MS,
  blenderThumbTimeoutReason,
  buildThumbArgs,
  parseThumbSummary,
} from './blenderThumb';

describe('buildThumbArgs', () => {
  it('launches Blender without preferences or add-on, and makes the script fail with a non-zero exit code', () => {
    const args = buildThumbArgs('/scripts/render_thumb.py', { input: '/tmp/m.glb', output: '/tmp/t.png' });
    expect(args.slice(0, 6)).toEqual([
      '-b',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      '/scripts/render_thumb.py',
    ]);
    expect(args).toContain('--');
    expect(args.slice(args.indexOf('--') + 1)).toEqual([
      '--input',
      '/tmp/m.glb',
      '--output',
      '/tmp/t.png',
      '--size',
      '512',
      '--samples',
      '24',
    ]);
  });

  it('sanitises size and samples rather than passing on an absurd value', () => {
    const args = buildThumbArgs('/s.py', { input: 'a', output: 'b', size: 4, samples: 0 });
    expect(args[args.indexOf('--size') + 1]).toBe('32');
    expect(args[args.indexOf('--samples') + 1]).toBe('1');
  });
});

describe('parseThumbSummary', () => {
  it('reads the last marked line in the Blender chatter', () => {
    const stdout = [
      'Read prefs: /root/.config/blender',
      `${BLENDER_THUMB_MARKER} {"rendered":false,"reason":"stale"}`,
      'Fra:1 Mem:12M | Rendering',
      `${BLENDER_THUMB_MARKER} {"rendered":true,"objects":3,"blender":"4.5.9"}`,
      'Blender quit',
    ].join('\n');
    expect(parseThumbSummary(stdout)).toEqual({
      rendered: true,
      reason: '',
      objects: 3,
      blender: '4.5.9',
    });
  });

  it('guesses nothing: without a marker or with broken JSON, the summary is absent', () => {
    expect(parseThumbSummary('{"rendered":true}')).toBeNull();
    expect(parseThumbSummary(`${BLENDER_THUMB_MARKER} {oops`)).toBeNull();
  });
});

describe('blenderThumbTimeoutReason', () => {
  it('names the limit exceeded, in seconds', () => {
    expect(blenderThumbTimeoutReason(BLENDER_THUMB_TIMEOUT_MS)).toBe('timeout:600s');
  });
});
