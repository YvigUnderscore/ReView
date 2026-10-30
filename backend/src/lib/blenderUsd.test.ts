// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  BLENDER_SUMMARY_MARKER,
  buildBlenderArgs,
  buildVariantMask,
  isUsdPurpose,
  parseBlenderSummary,
  summarizeBlenderError,
} from './blenderUsd';

describe('isUsdPurpose', () => {
  it('accepts only known USD purposes', () => {
    expect(isUsdPurpose('render')).toBe(true);
    expect(isUsdPurpose('proxy')).toBe(true);
    expect(isUsdPurpose('default')).toBe(false);
    expect(isUsdPurpose(42)).toBe(false);
  });
});

describe('buildBlenderArgs', () => {
  const base = { input: '/tmp/scene.usda', output: '/tmp/model.glb' };

  it('launches Blender headless without user preferences', () => {
    const args = buildBlenderArgs('/srv/usd_to_glb.py', base);
    expect(args.slice(0, 5)).toEqual(['-b', '--factory-startup', '--python-exit-code', '1', '--python']);
    // Script arguments come after the `--` separator.
    expect(args.indexOf('--input')).toBeGreaterThan(args.indexOf('--'));
    expect(args).toContain('/tmp/scene.usda');
    expect(args).toContain('--purpose');
    expect(args).toContain('render');
  });

  it('passes the frame range and fps when they are usable', () => {
    const args = buildBlenderArgs('/s.py', { ...base, frameStart: 1, frameEnd: 96, fps: 24 });
    expect(args).toContain('--frame-start');
    expect(args[args.indexOf('--frame-end') + 1]).toBe('96');
    expect(args[args.indexOf('--fps') + 1]).toBe('24');
  });

  it('ignores an inconsistent or incomplete range', () => {
    expect(buildBlenderArgs('/s.py', { ...base, frameStart: 10, frameEnd: 2 })).not.toContain(
      '--frame-start',
    );
    expect(buildBlenderArgs('/s.py', { ...base, frameStart: 1 })).not.toContain('--frame-start');
    expect(buildBlenderArgs('/s.py', { ...base, fps: 0 })).not.toContain('--fps');
  });

  it('allows forcing a static output', () => {
    expect(buildBlenderArgs('/s.py', { ...base, noAnimation: true })).toContain('--no-animation');
  });

  it('passes the variant baking budgets when they are positive (46.P)', () => {
    const args = buildBlenderArgs('/s.py', {
      ...base,
      variantLayers: '/tmp/manifest.json',
      variantVertexBudget: 8_000_000,
      variantTimeBudget: 450,
    });
    expect(args[args.indexOf('--variant-layers') + 1]).toBe('/tmp/manifest.json');
    expect(args[args.indexOf('--variant-vertex-budget') + 1]).toBe('8000000');
    expect(args[args.indexOf('--variant-time-budget') + 1]).toBe('450');
    // Without a time budget, baking is not artificially bounded.
    expect(buildBlenderArgs('/s.py', { ...base, variantTimeBudget: 0 })).not.toContain(
      '--variant-time-budget',
    );
  });
});

describe('buildVariantMask', () => {
  it('adds the materials stored outside the baked subtree (46.G)', () => {
    // Without them, the population mask removes them from the stage: the baked object loses its
    // binding and the viewer applies the default glTF material (mirror white metal).
    const mask = buildVariantMask('/characters/crag', [
      '/characters/crag/mtl/crag_body',
      '/characters/DietDefaultPreview',
    ]);
    expect(mask.split(',')).toEqual(['/characters/crag', '/characters/DietDefaultPreview']);
  });

  it('adds nothing when the scene stores its materials under the carrying prim', () => {
    expect(buildVariantMask('/W/A', ['/W/A/mtl/wood', '/W/A'])).toBe('/W/A');
    expect(buildVariantMask('/W/A')).toBe('/W/A');
  });

  it('is not fooled by a sibling prim with the same prefix', () => {
    // `/W/Asset2` is not in the subtree of `/W/Asset`: it must stay masked.
    expect(buildVariantMask('/W/Asset', ['/W/Asset2/mtl/wood'])).toBe('/W/Asset,/W/Asset2/mtl/wood');
  });

  it('deduplicates and drops paths that would break the list', () => {
    // The list is delimited by `,`/`;` and Blender only accepts absolute paths.
    const mask = buildVariantMask('/W/A', [
      '/W/mtl/a',
      '/W/mtl/a',
      'relatif/mtl/b',
      '/W/mtl/c,d',
      '/W/mtl/e;f',
    ]);
    expect(mask).toBe('/W/A,/W/mtl/a');
  });
});

describe('parseBlenderSummary', () => {
  it('finds the summary in the middle of Blender noise', () => {
    const stdout = [
      'Blender 4.5.0 (hash abc)',
      'Read prefs: /root/.config/blender',
      `${BLENDER_SUMMARY_MARKER} {"objects":12,"meshes":9,"materials":4,"animated":true,"frameStart":1,"frameEnd":96}`,
      'Blender quit',
    ].join('\n');
    const summary = parseBlenderSummary(stdout);
    expect(summary).toMatchObject({ objects: 12, meshes: 9, materials: 4, animated: true });
    expect(summary!.frameEnd).toBe(96);
  });

  it('returns null without a marker or with broken JSON', () => {
    expect(parseBlenderSummary('Blender quit')).toBeNull();
    expect(parseBlenderSummary(`${BLENDER_SUMMARY_MARKER} {pas du json}`)).toBeNull();
  });

  it('keeps the last summary if the script is called several times', () => {
    const stdout = `${BLENDER_SUMMARY_MARKER} {"objects":1}\n${BLENDER_SUMMARY_MARKER} {"objects":7}`;
    expect(parseBlenderSummary(stdout)!.objects).toBe(7);
  });
});

describe('summarizeBlenderError', () => {
  it('discards noise and keeps the last useful lines', () => {
    const stderr = [
      'Read prefs: /root/.config',
      'Warning: unsupported schema',
      'RuntimeError: scene USD vide apres import',
    ].join('\n');
    expect(summarizeBlenderError(stderr)).toBe('RuntimeError: scene USD vide apres import');
  });

  it('falls back to the default message when everything is noise', () => {
    expect(summarizeBlenderError('Warning: rien\nInfo: rien', 'échec Blender')).toBe('échec Blender');
  });

  it('bounds the length of the reported message', () => {
    expect(summarizeBlenderError('E'.repeat(2000)).length).toBeLessThanOrEqual(500);
  });
});
