// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

/**
 * Une séquence 4K EXR se compte en dizaines de gigaoctets : le chiffre doit être juste
 * (base 1024, comme l'explorateur de fichiers et la console MinIO) et lisible dans la
 * langue du lecteur — les formateurs déjà présents dans l'application écrivent « Mo » en
 * dur, ce qu'un lecteur japonais ne lit pas.
 */

describe('formatBytes', () => {
  it('choisit l’unité selon l’ordre de grandeur, en base 1024', () => {
    expect(formatBytes(512)).toMatch(/512/);
    expect(formatBytes(1024)).toMatch(/^1[^0-9]/);
    expect(formatBytes(1024 ** 3 * 12.5)).toMatch(/12[.,]5/);
  });

  it('ne montre pas de décimale sur des octets', () => {
    expect(formatBytes(999)).not.toMatch(/[.,]/);
  });

  it('encaisse le zéro, le négatif et l’infini sans produire « NaN »', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(value)).toMatch(/0/);
    }
  });

  it('reste borné au téraoctet plutôt que d’inventer une unité', () => {
    expect(formatBytes(1024 ** 6)).toMatch(/TB|To|TO/i);
  });
});
