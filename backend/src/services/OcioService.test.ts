// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { buildReleaseCatalog, getLut, isAllowedAssetHost } from './OcioService';
import { lutStorageKey } from '../lib/ocioBake';

const CONFIG_ID = '11111111-1111-4111-8111-111111111111';
const OCIO_TEXT = `displays:
  sRGB - Display:
    - !<View> {name: ACES 1.0 - SDR Video, view_transform: v, display_colorspace: d}
    - !<View> {name: Raw, colorspace: Raw}
active_displays: [sRGB - Display]
`;

const library = [
  {
    id: CONFIG_ID,
    name: 'Studio config',
    storageKey: 'studio/ocio/abc.ocio',
    assetName: 'studio-config.ocio',
    isDefault: true,
  },
];

// `vi.hoisted` : les fabriques de `vi.mock` sont remontées en tête de fichier et s'exécutent
// avant les `const` ordinaires — sans cela, les doublures seraient en zone morte temporelle.
const { storageMock, enqueueMock, findUniqueMock } = vi.hoisted(() => ({
  storageMock: {
    getObjectStream: vi.fn(),
    statObject: vi.fn(),
    getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio.test/${key}`)),
    putObject: vi.fn(() => Promise.resolve()),
    deleteObject: vi.fn(() => Promise.resolve()),
    deletePrefix: vi.fn(() => Promise.resolve()),
  },
  enqueueMock: vi.fn(() => Promise.resolve()),
  findUniqueMock: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { setting: { findUnique: findUniqueMock } } }));
vi.mock('./StorageService', () => ({ storage: storageMock }));
vi.mock('../workers/ocio/queue', () => ({ enqueueOcioBake: enqueueMock }));

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
    expect(catalog[0]!.tag).toBe('v2.1.0');
    expect(catalog[0]!.assets).toHaveLength(2); // le .md est ignoré
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
    const assets = catalog[0]!.assets;
    const studio = assets[0]!;
    const cg = assets[1]!;
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

describe('OcioService — LUT d’affichage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({ value: JSON.stringify(library) });
    storageMock.getObjectStream.mockImplementation(() =>
      Promise.resolve(Readable.from([Buffer.from(OCIO_TEXT)])),
    );
    storageMock.statObject.mockRejectedValue(new Error('not found'));
  });

  it('refuse un couple display/view absent de la config (aucune clé arbitraire écrite)', async () => {
    await expect(getLut(CONFIG_ID, 'Made up - Display', 'Raw')).rejects.toMatchObject({
      code: 'OCIO_BAD_DISPLAY_VIEW',
    });
    await expect(getLut(CONFIG_ID, 'sRGB - Display', '../../etc/passwd')).rejects.toMatchObject({
      code: 'OCIO_BAD_DISPLAY_VIEW',
    });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it('cuit à la demande la vue colorimétrique et la range à côté du .ocio', async () => {
    const info = await getLut(CONFIG_ID, 'sRGB - Display', 'Raw');
    const key = lutStorageKey(CONFIG_ID, 'sRGB - Display', 'Raw');
    expect(storageMock.putObject).toHaveBeenCalledWith(
      key,
      expect.any(Buffer),
      expect.stringContaining('text/plain'),
    );
    expect(info.url).toBe(`https://minio.test/${key}`);
    expect(info.reason).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('sert la LUT déjà cuite sans la recuire', async () => {
    storageMock.statObject.mockResolvedValue({ size: 10, contentType: 'text/plain' });
    const info = await getLut(CONFIG_ID, 'sRGB - Display', 'ACES 1.0 - SDR Video');
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(info.url).toContain(lutStorageKey(CONFIG_ID, 'sRGB - Display', 'ACES 1.0 - SDR Video'));
  });

  it('une vue tone-mappée non cuite demande le worker plutôt qu’une approximation', async () => {
    const info = await getLut(CONFIG_ID, 'sRGB - Display', 'ACES 1.0 - SDR Video');
    expect(info.url).toBeNull();
    expect(info.reason).toBe('OCIO_TOOLING_REQUIRED');
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith({
      configId: CONFIG_ID,
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
    });
  });
});
