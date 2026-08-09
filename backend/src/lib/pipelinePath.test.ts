// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parsePipelinePath, formatPipelinePath } from './pipelinePath';

describe('parsePipelinePath', () => {
  it('résout un projet seul', () => {
    expect(parsePipelinePath('PROJ')).toEqual({ project: 'PROJ', kind: 'project' });
  });

  it('résout la chaîne séquence → shot → tâche → version', () => {
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

  it('distingue un shot sans séquence via le mot-clé shots', () => {
    expect(parsePipelinePath('PROJ/shots/SH0100')).toEqual({
      project: 'PROJ',
      shot: 'SH0100',
      task: undefined,
      version: undefined,
      kind: 'shot',
    });
  });

  it('résout la branche asset', () => {
    expect(parsePipelinePath('PROJ/assets/hero/model/v002')).toEqual({
      project: 'PROJ',
      asset: 'hero',
      task: 'model',
      version: 'v002',
      kind: 'version',
    });
  });

  it('accepte les mots-clés quelle que soit la casse', () => {
    expect(parsePipelinePath('PROJ/Assets/hero').kind).toBe('asset');
    expect(parsePipelinePath('PROJ/SHOTS/SH010').kind).toBe('shot');
  });

  it('tolère les séparateurs superflus', () => {
    expect(parsePipelinePath('/PROJ//SQ010/ SH0100 /')).toMatchObject({
      sequence: 'SQ010',
      shot: 'SH0100',
    });
  });

  it('refuse un chemin vide, trop profond, ou une branche incomplète', () => {
    expect(() => parsePipelinePath('')).toThrow(/vide/i);
    expect(() => parsePipelinePath('///')).toThrow(/vide/i);
    expect(() => parsePipelinePath('a/b/c/d/e/f/g')).toThrow(/profond/i);
    expect(() => parsePipelinePath('PROJ/assets')).toThrow(/incomplet/i);
    expect(() => parsePipelinePath('PROJ/shots')).toThrow(/incomplet/i);
    expect(() => parsePipelinePath(`PROJ/${'x'.repeat(201)}`)).toThrow(/trop long/i);
  });
});

describe('département dans le segment de tâche', () => {
  it('sépare « département:tâche » sur les trois branches', () => {
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

  it('laisse les chemins historiques sans département', () => {
    expect(parsePipelinePath('PROJ/SQ010/SH0100/anim/v003').department).toBeUndefined();
  });

  it('refuse un segment de tâche amputé de l’un de ses deux côtés', () => {
    expect(() => parsePipelinePath('PROJ/SQ010/SH0100/:main')).toThrow(/malformé/i);
    expect(() => parsePipelinePath('PROJ/SQ010/SH0100/layout:')).toThrow(/malformé/i);
    expect(() => parsePipelinePath('PROJ/assets/hero/ : ')).toThrow(/malformé/i);
  });
});

describe('formatPipelinePath', () => {
  it("reconstruit le chemin d'origine (aller-retour)", () => {
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
