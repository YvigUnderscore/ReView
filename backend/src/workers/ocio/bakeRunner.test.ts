// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  bakeWithPython,
  OCIO_BAKE_MARKER,
  parseBakeSummary,
  probePyOcio,
  pythonBakeArgs,
  resetOcioProbe,
  resolveOcioScript,
  type ExecRunner,
} from './bakeRunner';

const options = {
  configPath: '/tmp/config.ocio',
  display: 'sRGB - Display',
  view: 'ACES 1.0 - SDR Video',
  inputSpace: 'sRGB - Texture;srgb_tx',
  size: 33,
  outPath: '/tmp/out.cube',
};

const summaryLine = (over: Record<string, unknown> = {}) =>
  `${OCIO_BAKE_MARKER} ${JSON.stringify({ display: options.display, view: options.view, size: 33, ocio: '2.4.1', ...over })}`;

describe('bakeRunner — command line', () => {
  it('passes each parameter as a separate argument (no shell, no escaping)', () => {
    const args = pythonBakeArgs('/app/bake_lut.py', options);
    expect(args[0]).toBe('/app/bake_lut.py');
    expect(args).toContain('--display');
    expect(args[args.indexOf('--display') + 1]).toBe('sRGB - Display');
    expect(args[args.indexOf('--view') + 1]).toBe('ACES 1.0 - SDR Video');
    expect(args[args.indexOf('--size') + 1]).toBe('33');
    expect(args[args.indexOf('--out') + 1]).toBe('/tmp/out.cube');
  });

  it('resolves a script path ending in bake_lut.py', () => {
    expect(resolveOcioScript()).toMatch(/bake_lut\.py$/);
  });
});

describe('bakeRunner — script summary', () => {
  it('reads the last marked line, amid the noise', () => {
    const out = `warning: some OCIO noise\n${summaryLine()}\n`;
    expect(parseBakeSummary(out)).toMatchObject({ display: options.display, size: 33 });
  });

  it('returns null without a marker, or on broken JSON', () => {
    expect(parseBakeSummary('nothing here')).toBeNull();
    expect(parseBakeSummary(`${OCIO_BAKE_MARKER} {oops`)).toBeNull();
    expect(parseBakeSummary(`${OCIO_BAKE_MARKER} {"size":33}`)).toBeNull();
  });
});

describe('bakeRunner — probe and execution', () => {
  beforeEach(() => resetOcioProbe());

  it('the probe is cached and does not relaunch Python', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) as unknown as ExecRunner;
    expect(await probePyOcio(runner)).toBe(true);
    expect(await probePyOcio(runner)).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('the probe answers false when PyOpenColorIO is missing', async () => {
    const runner = (() => Promise.reject(new Error('ModuleNotFoundError'))) as unknown as ExecRunner;
    expect(await probePyOcio(runner)).toBe(false);
  });

  it('bakes a pair and returns the summary', async () => {
    const runner = (() => Promise.resolve({ stdout: summaryLine(), stderr: '' })) as ExecRunner;
    await expect(bakeWithPython(options, runner)).resolves.toMatchObject({ size: 33, ocio: '2.4.1' });
  });

  it('refuses an output without summary or of unexpected size', async () => {
    const mute = (() => Promise.resolve({ stdout: '', stderr: '' })) as ExecRunner;
    await expect(bakeWithPython(options, mute)).rejects.toThrow(/no summary/);
    const wrong = (() => Promise.resolve({ stdout: summaryLine({ size: 17 }), stderr: '' })) as ExecRunner;
    await expect(bakeWithPython(options, wrong)).rejects.toThrow(/size 17/);
  });
});
