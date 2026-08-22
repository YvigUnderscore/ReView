// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ffmpegFrameRate,
  frameNameOf,
  framePattern,
  groupFrameNames,
  isSafeFrameName,
  localFrameName,
  localFramePattern,
  looksLikeSequencePattern,
  MIN_SEQUENCE_FRAMES,
  parseFrameName,
  parseFramePattern,
  sequenceFrameKey,
  sequenceFramePrefix,
  sequenceInputOptions,
  sequenceManifestKey,
  sequenceSummary,
} from './imageSequence';

/**
 * Reconnaissance des séquences d'images.
 *
 * Le piège du domaine tient en un nom : `SH0100_comp_v003.1001.exr` porte DEUX nombres.
 * Prendre le premier regroupe tout le plan sous « version 3 » ; prendre le dernier avant
 * l'extension est la seule lecture juste. Le reste des cas — trous, padding, plusieurs
 * séquences dans un même dépôt — décide de ce qui sera proposé à l'utilisateur.
 */

describe('parseFrameName — le numéro de frame est le dernier avant l’extension', () => {
  it('ne confond pas le numéro de version avec le numéro de frame', () => {
    expect(parseFrameName('SH0100_comp_v003.1001.exr')).toEqual({
      base: 'SH0100_comp_v003.',
      number: 1001,
      digits: 4,
      extension: '.exr',
    });
  });

  it('accepte les trois séparateurs vus en production (point, souligné, collé)', () => {
    expect(parseFrameName('plan_1001.dpx')?.base).toBe('plan_');
    expect(parseFrameName('plan-1001.dpx')?.base).toBe('plan-');
    expect(parseFrameName('plan1001.dpx')?.base).toBe('plan');
  });

  it('conserve la largeur du champ, zéros de tête compris', () => {
    expect(parseFrameName('plan.0042.exr')).toMatchObject({ number: 42, digits: 4 });
    expect(parseFrameName('plan.42.exr')).toMatchObject({ number: 42, digits: 2 });
  });

  it('normalise l’extension et refuse ce qui n’est pas numéroté', () => {
    expect(parseFrameName('plan.1001.EXR')?.extension).toBe('.exr');
    expect(parseFrameName('planche.exr')).toBeNull();
    expect(parseFrameName('sans-extension-1001')).toBeNull();
  });

  it('refuse un nombre trop long pour être une frame (horodatage, identifiant)', () => {
    expect(parseFrameName('render_1723458123456.exr')).toBeNull();
  });
});

describe('isSafeFrameName — le nom devient une clé de stockage', () => {
  it('accepte les noms de livraison réels', () => {
    expect(isSafeFrameName('SH0100_comp_v003.1001.exr')).toBe(true);
  });

  it('refuse tout ce qui se déguise en chemin', () => {
    for (const name of ['../secret.exr', 'a/b.exr', '/etc/passwd', '.hidden.exr', 'plan 1001.exr', '']) {
      expect(isSafeFrameName(name)).toBe(false);
    }
  });

  it('refuse un nom démesuré', () => {
    expect(isSafeFrameName(`${'a'.repeat(240)}.exr`)).toBe(false);
  });
});

describe('framePattern / parseFramePattern', () => {
  it('fait l’aller-retour', () => {
    const pattern = framePattern('SH0100_comp_v003.', 4, '.exr');
    expect(pattern).toBe('SH0100_comp_v003.%04d.exr');
    expect(parseFramePattern(pattern)).toEqual({
      base: 'SH0100_comp_v003.',
      digits: 4,
      extension: '.exr',
    });
  });

  it('refuse ce qui n’est pas un motif', () => {
    expect(parseFramePattern('plan.1001.exr')).toBeNull();
    expect(parseFramePattern('plan.%d.exr')).toBeNull();
  });

  it('reconstruit le nom d’une frame donnée', () => {
    expect(frameNameOf('plan.', 4, '.exr', 1001)).toBe('plan.1001.exr');
    expect(frameNameOf('plan.', 4, '.exr', 7)).toBe('plan.0007.exr');
  });

  it('reconnaît un motif là où on attend un fichier (API v1)', () => {
    expect(looksLikeSequencePattern('plan.%04d.exr')).toBe(true);
    expect(looksLikeSequencePattern('plan.####.exr')).toBe(true);
    expect(looksLikeSequencePattern('SH0100_comp_v003.1001.exr')).toBe(false);
  });
});

describe('groupFrameNames — proposer, jamais imposer', () => {
  const seq = (base: string, from: number, to: number, ext = '.exr'): string[] =>
    Array.from({ length: to - from + 1 }, (_, i) => `${base}${String(from + i).padStart(4, '0')}${ext}`);

  it('regroupe un plan complet en une seule proposition', () => {
    const { sequences, singles } = groupFrameNames(seq('SH0100_comp_v003.', 1001, 1100));
    expect(singles).toEqual([]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.pattern).toBe('SH0100_comp_v003.%04d.exr');
    expect(sequences[0]!.frames).toHaveLength(100);
  });

  it('sépare deux séquences déposées ensemble, et laisse les fichiers isolés de côté', () => {
    const { sequences, singles } = groupFrameNames([
      ...seq('SH0100_comp_v003.', 1001, 1010),
      ...seq('SH0200_comp_v001.', 1001, 1010),
      'notes.txt',
      'SH0100_comp_v003.mov',
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual([
      'SH0100_comp_v003.%04d.exr',
      'SH0200_comp_v001.%04d.exr',
    ]);
    expect([...singles].sort()).toEqual(['SH0100_comp_v003.mov', 'notes.txt']);
  });

  it('garde une numérotation à trous : c’est un fait de production, pas une erreur', () => {
    const names = ['plan.1001.exr', 'plan.1002.exr', 'plan.1005.exr'];
    const { sequences } = groupFrameNames(names);
    expect(sequences[0]!.frames).toEqual([1001, 1002, 1005]);
    expect(sequenceSummary(sequences[0]!.frames)).toEqual({
      startFrame: 1001,
      endFrame: 1005,
      frameCount: 3,
      missingFrames: 2,
    });
  });

  it('trie par numéro, quel que soit l’ordre du dépôt', () => {
    const { sequences } = groupFrameNames(['plan.0010.exr', 'plan.0002.exr', 'plan.0100.exr']);
    expect(sequences[0]!.frames).toEqual([2, 10, 100]);
    expect(sequences[0]!.names[0]).toBe('plan.0002.exr');
  });

  it('ne propose pas une séquence d’un seul fichier', () => {
    const { sequences, singles } = groupFrameNames(['plan.1001.exr']);
    expect(MIN_SEQUENCE_FRAMES).toBe(2);
    expect(sequences).toEqual([]);
    expect(singles).toEqual(['plan.1001.exr']);
  });

  it('ne mélange pas deux paddings ni deux extensions sous un même motif', () => {
    const { sequences } = groupFrameNames([
      'plan.001.exr',
      'plan.002.exr',
      'plan.0001.exr',
      'plan.0002.exr',
      'plan.0001.dpx',
      'plan.0002.dpx',
    ]);
    expect(sequences.map((s) => s.pattern).sort()).toEqual([
      'plan.%03d.exr',
      'plan.%04d.dpx',
      'plan.%04d.exr',
    ]);
  });
});

describe('conventions de clés MinIO', () => {
  const storageKey = 'projects/demo/shots/sq010/sh0100/v01/42/sequence.json';

  it('range les frames sous un préfixe voisin du manifeste', () => {
    expect(sequenceFramePrefix(storageKey)).toBe('projects/demo/shots/sq010/sh0100/v01/42/frames/');
    expect(sequenceManifestKey('projects/demo/shots/sq010/sh0100/v01/42/plan.exr')).toBe(storageKey);
  });

  it('compose la clé d’une frame à partir du nom livré', () => {
    expect(sequenceFrameKey(sequenceFramePrefix(storageKey), 'plan.1001.exr')).toBe(
      'projects/demo/shots/sq010/sh0100/v01/42/frames/plan.1001.exr',
    );
  });
});

describe('assemblage FFmpeg', () => {
  it('renumérote localement pour que le démultiplexeur ne s’arrête pas au premier trou', () => {
    expect(localFrameName(0, '.exr')).toBe('f_000000.exr');
    expect(localFrameName(1234, '.exr')).toBe('f_001234.exr');
    expect(localFramePattern('.exr')).toBe('f_%06d.exr');
  });

  it('écrit les cadences NTSC en fraction exacte, jamais en 23.98', () => {
    expect(ffmpegFrameRate(23.976)).toBe('24000/1001');
    expect(ffmpegFrameRate(23.98)).toBe('24000/1001');
    expect(ffmpegFrameRate(29.97)).toBe('30000/1001');
    expect(ffmpegFrameRate(24)).toBe('24');
    expect(ffmpegFrameRate(25)).toBe('25');
  });

  it('applique la courbe sRGB à l’EXR — sans elle, un rendu correct sort quasi noir', () => {
    expect(sequenceInputOptions(24, '.exr')).toEqual([
      '-framerate',
      '24',
      '-start_number',
      '0',
      '-apply_trc',
      'iec61966_2_1',
    ]);
  });

  it('ne pose aucune courbe sur un format qui n’en connaît pas l’option', () => {
    expect(sequenceInputOptions(25, '.dpx')).toEqual(['-framerate', '25', '-start_number', '0']);
  });
});
