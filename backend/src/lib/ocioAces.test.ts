// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  parseAcesAsset,
  pickRecommended,
  isDefaultCandidate,
  compareVersions,
  acesDisplayName,
  DEFAULT_ACES_VERSION,
} from './ocioAces';

describe('ocioAces — parsing des assets ACES (39.B)', () => {
  it('parse un asset studio-config', () => {
    expect(parseAcesAsset('studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio')).toEqual({
      kind: 'studio',
      configVersion: '2.1.0',
      acesVersion: '1.3',
      ocioVersion: '2.3',
      assetName: 'studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
    });
  });

  it('parse un asset cg-config', () => {
    const info = parseAcesAsset('cg-config-v2.2.0_aces-v1.3_ocio-v2.4.ocio');
    expect(info?.kind).toBe('cg');
    expect(info?.configVersion).toBe('2.2.0');
  });

  it('renvoie null pour un asset non reconnu', () => {
    expect(parseAcesAsset('README.md')).toBeNull();
    expect(parseAcesAsset('studio-config.ocio')).toBeNull();
    expect(parseAcesAsset('config.zip')).toBeNull();
  });

  it('compareVersions gère le numérique (2.10 > 2.9)', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3', '1.3')).toBe(0);
    expect(compareVersions('2.0.0', '2.1.0')).toBeLessThan(0);
  });

  it('pickRecommended choisit la studio config ACES 1.3 la plus récente', () => {
    const infos = [
      parseAcesAsset('cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio')!,
      parseAcesAsset('studio-config-v2.0.0_aces-v1.3_ocio-v2.3.ocio')!,
      parseAcesAsset('studio-config-v2.2.0_aces-v1.3_ocio-v2.4.ocio')!,
      parseAcesAsset('studio-config-v3.0.0_aces-v2.0_ocio-v2.4.ocio')!,
    ];
    const rec = pickRecommended(infos);
    expect(rec?.kind).toBe('studio');
    expect(rec?.acesVersion).toBe(DEFAULT_ACES_VERSION);
    expect(rec?.configVersion).toBe('2.2.0');
  });

  it('pickRecommended retombe sur la studio ACES la plus récente si pas de 1.3', () => {
    const infos = [
      parseAcesAsset('studio-config-v3.0.0_aces-v2.0_ocio-v2.4.ocio')!,
      parseAcesAsset('studio-config-v2.5.0_aces-v1.4_ocio-v2.4.ocio')!,
    ];
    expect(pickRecommended(infos)?.acesVersion).toBe('2.0');
  });

  it('pickRecommended renvoie null pour une liste vide', () => {
    expect(pickRecommended([])).toBeNull();
  });

  it('isDefaultCandidate ne retient que la studio ACES 1.3', () => {
    expect(isDefaultCandidate(parseAcesAsset('studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio')!)).toBe(true);
    expect(isDefaultCandidate(parseAcesAsset('cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio')!)).toBe(false);
    expect(isDefaultCandidate(parseAcesAsset('studio-config-v3.0.0_aces-v2.0_ocio-v2.4.ocio')!)).toBe(false);
  });

  it('acesDisplayName produit un libellé lisible', () => {
    expect(acesDisplayName(parseAcesAsset('studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio')!)).toBe(
      'Studio config — ACES 1.3 (config v2.1.0, OCIO 2.3)',
    );
  });
});
