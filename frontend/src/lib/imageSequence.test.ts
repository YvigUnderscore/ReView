// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectSequences, parseFrameName } from './imageSequence';

/**
 * Ce que la file d'upload voit d'un dépôt.
 *
 * Sans cette lecture, déposer un plan crée mille médias. Les cas ci-dessous sont ceux qui
 * arrivent réellement d'un explorateur de fichiers : un plan complet, deux plans mélangés,
 * une numérotation à trous, et le fourre-tout (notes, quicktime de référence) qui
 * accompagne toujours la livraison.
 */

const file = (name: string, size = 1024): File => ({ name, size }) as unknown as File;

const plan = (base: string, from: number, to: number, ext = '.exr', size = 1024): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) =>
    file(`${base}${String(from + i).padStart(4, '0')}${ext}`, size),
  );

describe('parseFrameName', () => {
  it('prend le dernier nombre, pas le numéro de version', () => {
    expect(parseFrameName('SH0100_comp_v003.1001.exr')).toEqual({
      base: 'SH0100_comp_v003.',
      number: 1001,
      digits: 4,
      extension: '.exr',
    });
  });

  it('rend null sur un nom sans numérotation', () => {
    expect(parseFrameName('planche-contact.jpg')).toBeNull();
  });
});

describe('detectSequences', () => {
  it('reconnaît un plan complet et le rend prêt à envoyer', () => {
    const { sequences, singles } = detectSequences(plan('SH0100_comp_v003.', 1001, 1200, '.exr', 2048));
    expect(singles).toEqual([]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      pattern: 'SH0100_comp_v003.%04d.exr',
      startFrame: 1001,
      endFrame: 1200,
      frameCount: 200,
      missingFrames: 0,
      totalSize: 200 * 2048,
    });
  });

  it('sépare deux plans déposés ensemble et met de côté le reste de la livraison', () => {
    const { sequences, singles } = detectSequences([
      ...plan('SH0100_comp_v003.', 1001, 1010),
      ...plan('SH0200_comp_v001.', 1001, 1010),
      file('notes.txt'),
      file('SH0100_comp_v003.mov'),
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual([
      'SH0100_comp_v003.%04d.exr',
      'SH0200_comp_v001.%04d.exr',
    ]);
    expect(singles.map((s) => s.name).sort()).toEqual(['SH0100_comp_v003.mov', 'notes.txt']);
  });

  it('compte les trous sans refuser la livraison', () => {
    const { sequences } = detectSequences([
      file('plan.1001.exr'),
      file('plan.1002.exr'),
      file('plan.1010.exr'),
    ]);
    expect(sequences[0]).toMatchObject({ startFrame: 1001, endFrame: 1010, frameCount: 3, missingFrames: 7 });
  });

  it('trie les fichiers par numéro, quel que soit l’ordre du système de fichiers', () => {
    const { sequences } = detectSequences([
      file('plan.0100.exr'),
      file('plan.0002.exr'),
      file('plan.0010.exr'),
    ]);
    expect(sequences[0].files.map((f) => f.name)).toEqual([
      'plan.0002.exr',
      'plan.0010.exr',
      'plan.0100.exr',
    ]);
  });

  it('ne propose pas une séquence pour un fichier isolé', () => {
    const { sequences, singles } = detectSequences([file('plan.1001.exr')]);
    expect(sequences).toEqual([]);
    expect(singles).toHaveLength(1);
  });

  it('ne regroupe pas des formats que l’ingestion refuserait ensuite', () => {
    const { sequences, singles } = detectSequences(plan('take.', 1, 5, '.mov'));
    expect(sequences).toEqual([]);
    expect(singles).toHaveLength(5);
  });

  it('ne mélange pas deux paddings sous un même motif', () => {
    const { sequences } = detectSequences([
      file('plan.001.exr'),
      file('plan.002.exr'),
      file('plan.0001.exr'),
      file('plan.0002.exr'),
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual(['plan.%03d.exr', 'plan.%04d.exr']);
  });
});
