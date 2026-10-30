// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parsePipelinePath, formatPipelinePath } from './pipelinePath';

describe('parsePipelinePath', () => {
  it('resolves a project alone', () => {
    expect(parsePipelinePath('PROJ')).toEqual({ project: 'PROJ', kind: 'project' });
  });

  it('resolves the chain sequence → shot → task → version', () => {
    expect(parsePipelinePath('PROJ/SQ010')).toMatchObject({ sequence: 'SQ010', kind: 'sequence' });
    expect(parsePipelinePath('PROJ/SQ010/SH0100')).toMatchObject({ shot: 'SH0100', kind: 'shot' });
    expect(parsePipelinePath('PROJ/SQ010/SH0100/anim')).toMatchObject({ task: 'anim', kind: 'task' });
    expect(parsePipelinePath('PROJ/SQ010/SH0100/anim/v003')).toEqual({
      project: 'PROJ',
      sequence: 'SQ010',
      shot: 'SH0100',
      task: 'anim',
      version: 'v003',
      kind: 'version',
    });
  });

  it('distinguishes a shot without a sequence via the shots keyword', () => {
    expect(parsePipelinePath('PROJ/shots/SH0100')).toEqual({
      project: 'PROJ',
      shot: 'SH0100',
      task: undefined,
      version: undefined,
      kind: 'shot',
    });
  });

  it('resolves the asset branch', () => {
    expect(parsePipelinePath('PROJ/assets/hero/model/v002')).toEqual({
      project: 'PROJ',
      asset: 'hero',
      task: 'model',
      version: 'v002',
      kind: 'version',
    });
  });

  it('accepts the keywords whatever the case', () => {
    expect(parsePipelinePath('PROJ/Assets/hero').kind).toBe('asset');
    expect(parsePipelinePath('PROJ/SHOTS/SH010').kind).toBe('shot');
  });

  it('tolerates superfluous separators', () => {
    expect(parsePipelinePath('/PROJ//SQ010/ SH0100 /')).toMatchObject({
      sequence: 'SQ010',
      shot: 'SH0100',
    });
  });

  it('refuses an empty path, a path too deep, or an incomplete branch', () => {
    expect(() => parsePipelinePath('')).toThrow(/empty path/i);
    expect(() => parsePipelinePath('///')).toThrow(/empty path/i);
    expect(() => parsePipelinePath('a/b/c/d/e/f/g')).toThrow(/too deep/i);
    expect(() => parsePipelinePath('PROJ/assets')).toThrow(/incomplet/i);
    expect(() => parsePipelinePath('PROJ/shots')).toThrow(/incomplet/i);
    expect(() => parsePipelinePath(`PROJ/${'x'.repeat(201)}`)).toThrow(/too long/i);
  });
});

describe('department in the task segment', () => {
  it('splits "department:task" on the three branches', () => {
    expect(parsePipelinePath('PROJ/SQ010/SH0100/layout:main/v001')).toMatchObject({
      task: 'main',
      department: 'layout',
      version: 'v001',
      kind: 'version',
    });
    expect(parsePipelinePath('PROJ/shots/SH0100/anim:blocking')).toMatchObject({
      task: 'blocking',
      department: 'anim',
      kind: 'task',
    });
    expect(parsePipelinePath('PROJ/assets/hero/modeling:main')).toMatchObject({
      task: 'main',
      department: 'modeling',
      kind: 'task',
    });
  });

  it('leaves the historical paths without a department', () => {
    expect(parsePipelinePath('PROJ/SQ010/SH0100/anim/v003').department).toBeUndefined();
  });

  it('refuses a task segment cut on one of its two sides', () => {
    expect(() => parsePipelinePath('PROJ/SQ010/SH0100/:main')).toThrow(/malformed/i);
    expect(() => parsePipelinePath('PROJ/SQ010/SH0100/layout:')).toThrow(/malformed/i);
    expect(() => parsePipelinePath('PROJ/assets/hero/ : ')).toThrow(/malformed/i);
  });
});

describe('formatPipelinePath', () => {
  it('rebuilds the original path (round trip)', () => {
    for (const path of [
      'PROJ',
      'PROJ/SQ010',
      'PROJ/SQ010/SH0100/anim/v003',
      'PROJ/shots/SH0100/anim',
      'PROJ/assets/hero/model/v002',
      'PROJ/SQ010/SH0100/layout:main/v001',
      'PROJ/assets/hero/lookdev:main',
    ]) {
      expect(formatPipelinePath(parsePipelinePath(path))).toBe(path);
    }
  });
});
