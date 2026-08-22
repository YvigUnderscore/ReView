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
  it('lance Blender sans préférences ni addon, et fait échouer le script en code non nul', () => {
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

  it('assainit taille et échantillons plutôt que de transmettre une valeur absurde', () => {
    const args = buildThumbArgs('/s.py', { input: 'a', output: 'b', size: 4, samples: 0 });
    expect(args[args.indexOf('--size') + 1]).toBe('32');
    expect(args[args.indexOf('--samples') + 1]).toBe('1');
  });
});

describe('parseThumbSummary', () => {
  it('lit la dernière ligne marquée dans le bavardage de Blender', () => {
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

  it('ne devine rien : sans marqueur ou avec un JSON cassé, le résumé est absent', () => {
    expect(parseThumbSummary('{"rendered":true}')).toBeNull();
    expect(parseThumbSummary(`${BLENDER_THUMB_MARKER} {oops`)).toBeNull();
  });
});

describe('blenderThumbTimeoutReason', () => {
  it('nomme la limite dépassée en secondes', () => {
    expect(blenderThumbTimeoutReason(BLENDER_THUMB_TIMEOUT_MS)).toBe('timeout:600s');
  });
});
