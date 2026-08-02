// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildReleaseCatalog, isAllowedAssetHost } from './OcioService';

const release = (tag: string, assetNames: string[]) => ({
  tag_name: tag,
  name: `Release ${tag}`,
  published_at: '2024-01-01T00:00:00Z',
  assets: assetNames.map((name, i) => ({
    name,
    browser_download_url: `https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases/download/${tag}/${name}`,
    size: 100000 + i,
  })),
});

describe('OcioService — buildReleaseCatalog (39.B)', () => {
  it('ne garde que les releases avec un asset .ocio reconnu', () => {
    const catalog = buildReleaseCatalog(
      [
        release('v2.1.0', [
          'studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
          'cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
          'README.md',
        ]),
        release('v0.0.1', ['notes.txt']), // aucun asset reconnu → exclue
      ],
      new Set(),
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0].tag).toBe('v2.1.0');
    expect(catalog[0].assets).toHaveLength(2); // le .md est ignoré
  });

  it('marque le défaut recommandé (studio ACES 1.3) et l’état installé', () => {
    const catalog = buildReleaseCatalog(
      [
        release('v2.1.0', [
          'studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
          'cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
        ]),
      ],
      new Set(['cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio']),
    );
    const [studio, cg] = catalog[0].assets;
    expect(studio.recommendedDefault).toBe(true);
    expect(studio.installed).toBe(false);
    expect(cg.recommendedDefault).toBe(false);
    expect(cg.installed).toBe(true);
    expect(studio.label).toContain('Studio config');
  });

  it('isAllowedAssetHost n’autorise que les hôtes GitHub connus', () => {
    expect(isAllowedAssetHost('https://github.com/x/y/releases/download/v1/a.ocio')).toBe(true);
    expect(isAllowedAssetHost('https://objects.githubusercontent.com/z')).toBe(true);
    expect(isAllowedAssetHost('https://evil.example.com/a.ocio')).toBe(false);
    expect(isAllowedAssetHost('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedAssetHost('not a url')).toBe(false);
  });
});
