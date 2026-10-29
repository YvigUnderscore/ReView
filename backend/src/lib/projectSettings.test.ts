// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  applyPipelineOverride,
  pipelineOf,
  resolveEntitySettings,
  checkNaming,
  projectSettingsSchema,
  type ProjectSettings,
  type PipelineSettings,
} from './projectSettings';

const project: ProjectSettings = {
  departments: [],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

const base: PipelineSettings = { resolution: { width: 1920, height: 1080 }, framerate: 24 };

describe('projectSettings — pipeline & inheritance (Phase 18)', () => {
  it('pipelineOf extracts resolution + framerate from the project settings', () => {
    expect(pipelineOf(project)).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 24 });
  });

  it('applyPipelineOverride lets inheritance apply when the JSON is empty', () => {
    expect(applyPipelineOverride(base, {})).toEqual(base);
    expect(applyPipelineOverride(base, null)).toEqual(base);
    expect(applyPipelineOverride(base, undefined)).toEqual(base);
  });

  it('applyPipelineOverride overrides resolution and framerate when present', () => {
    const out = applyPipelineOverride(base, { resolution: { width: 3840, height: 2160 }, framerate: 30 });
    expect(out).toEqual({ resolution: { width: 3840, height: 2160 }, framerate: 30 });
  });

  it('applyPipelineOverride partially overrides (framerate only)', () => {
    const out = applyPipelineOverride(base, { framerate: 25 });
    expect(out).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 25 });
  });

  it('applyPipelineOverride bounds the dimensions and the framerate', () => {
    const out = applyPipelineOverride(base, { resolution: { width: 0, height: 999999 }, framerate: 9999 });
    expect(out.resolution.width).toBe(1); // clamped to the minimum
    expect(out.resolution.height).toBe(16384); // clamped to the maximum
    expect(out.framerate).toBe(240); // clamped to the maximum
  });

  it('applyPipelineOverride ignores non-numeric values', () => {
    const out = applyPipelineOverride(base, { framerate: 'abc', resolution: { width: 'x' } });
    expect(out.resolution.width).toBe(1920); // inherited (invalid value ignored)
    expect(out.framerate).toBe(24); // inherited
  });

  it('resolveEntitySettings inherits from the project without an override', () => {
    expect(resolveEntitySettings(project)).toEqual(base);
  });

  it("resolveEntitySettings applies the sequence override then the shot's (the closest wins)", () => {
    const out = resolveEntitySettings(
      project,
      { resolution: { width: 2048, height: 858 }, framerate: 25 }, // sequence
      { framerate: 48 }, // shot overrides the framerate only
    );
    expect(out).toEqual({ resolution: { width: 2048, height: 858 }, framerate: 48 });
  });

  it('resolveEntitySettings: a shot inherits the resolution of the sequence', () => {
    const out = resolveEntitySettings(project, { resolution: { width: 1280, height: 720 } }, {});
    expect(out).toEqual({ resolution: { width: 1280, height: 720 }, framerate: 24 });
  });
});

describe('projectSettings — checkNaming (38.C)', () => {
  it('always passes when the mode is off or the pattern is empty', () => {
    expect(checkNaming('x.mov', { pattern: '', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x.mov', { pattern: '^SH\\d+', mode: 'off' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x.mov', undefined)).toEqual({ pass: true, mode: 'off' });
  });

  it('evaluates the pattern and returns the mode (warn/reject)', () => {
    expect(checkNaming('SH010_v2.mov', { pattern: '^SH\\d{3}_v\\d+', mode: 'reject' })).toEqual({
      pass: true,
      mode: 'reject',
    });
    expect(checkNaming('mauvais.mov', { pattern: '^SH\\d{3}_v\\d+', mode: 'warn' })).toEqual({
      pass: false,
      mode: 'warn',
    });
  });

  it('an invalid regex never hinders the upload', () => {
    expect(checkNaming('x.mov', { pattern: '([', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
  });
});

describe('projectSettings — defaultLighting (39.F)', () => {
  const valid = {
    hdriId: 'clh123',
    exposure: 1.5,
    rotationDeg: 45,
    showBackground: true,
    groundShadow: true,
  };

  it('accepts a complete default lighting', () => {
    const parsed = projectSettingsSchema.parse({ defaultLighting: valid });
    expect(parsed.defaultLighting).toEqual(valid);
  });

  it('accepts without hdriId (neutral lighting by default)', () => {
    const parsed = projectSettingsSchema.parse({
      defaultLighting: { exposure: 1, rotationDeg: 0, showBackground: false, groundShadow: false },
    });
    expect(parsed.defaultLighting?.hdriId).toBeUndefined();
  });

  it('rejects an exposure out of bounds', () => {
    expect(() => projectSettingsSchema.parse({ defaultLighting: { ...valid, exposure: 99 } })).toThrow();
  });

  it('rejects a rotation out of bounds', () => {
    expect(() => projectSettingsSchema.parse({ defaultLighting: { ...valid, rotationDeg: 400 } })).toThrow();
  });
});

describe('projectSettings — OCIO colour (39.B)', () => {
  it('accepts a complete colour config', () => {
    const color = { configId: 'abc', display: 'sRGB - Display', view: 'ACES 1.0 - SDR Video' };
    expect(projectSettingsSchema.parse({ color }).color).toEqual(color);
  });

  it('accepts a partial colour config', () => {
    expect(projectSettingsSchema.parse({ color: { display: 'sRGB - Display' } }).color?.view).toBeUndefined();
  });
});
