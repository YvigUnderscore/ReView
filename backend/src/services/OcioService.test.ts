// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Readable } from 'node:stream';

// The SSRF guard resolves names: without a double, these tests would depend on the machine's DNS.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import {
  buildReleaseCatalog,
  getLut,
  install,
  isAllowedAssetHost,
  __resetReleasesCache,
} from './OcioService';
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

// `vi.hoisted`: the factories of `vi.mock` are hoisted to the top of the file and run before the ordinary
// `const` declarations — without this, the doubles would sit in a temporal dead zone.
const { storageMock, enqueueMock, findUniqueMock, upsertMock } = vi.hoisted(() => ({
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
  upsertMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { setting: { findUnique: findUniqueMock, upsert: upsertMock } },
}));
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

describe('OcioService: buildReleaseCatalog (39.B)', () => {
  it('keeps only releases with a recognised .ocio asset', () => {
    const catalog = buildReleaseCatalog(
      [
        release('v2.1.0', [
          'studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
          'cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio',
          'README.md',
        ]),
        release('v0.0.1', ['notes.txt']), // no recognised asset → excluded
      ],
      new Set(),
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.tag).toBe('v2.1.0');
    expect(catalog[0]!.assets).toHaveLength(2); // the .md is ignored
  });

  it('marks the recommended default (ACES 1.3 studio) and the installed state', () => {
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

  it('isAllowedAssetHost only allows known GitHub hosts', () => {
    expect(isAllowedAssetHost('https://github.com/x/y/releases/download/v1/a.ocio')).toBe(true);
    expect(isAllowedAssetHost('https://objects.githubusercontent.com/z')).toBe(true);
    expect(isAllowedAssetHost('https://evil.example.com/a.ocio')).toBe(false);
    expect(isAllowedAssetHost('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedAssetHost('not a url')).toBe(false);
  });
});

describe('OcioService: display LUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({ value: JSON.stringify(library) });
    storageMock.getObjectStream.mockImplementation(() =>
      Promise.resolve(Readable.from([Buffer.from(OCIO_TEXT)])),
    );
    storageMock.statObject.mockRejectedValue(new Error('not found'));
  });

  it('refuses a display/view pair absent from the config (no arbitrary key written)', async () => {
    await expect(getLut(CONFIG_ID, 'Made up - Display', 'Raw')).rejects.toMatchObject({
      code: 'OCIO_BAD_DISPLAY_VIEW',
    });
    await expect(getLut(CONFIG_ID, 'sRGB - Display', '../../etc/passwd')).rejects.toMatchObject({
      code: 'OCIO_BAD_DISPLAY_VIEW',
    });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it('bakes the colorimetric view on demand and stores it next to the .ocio', async () => {
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

  it('serves the already baked LUT without re-baking it', async () => {
    storageMock.statObject.mockResolvedValue({ size: 10, contentType: 'text/plain' });
    const info = await getLut(CONFIG_ID, 'sRGB - Display', 'ACES 1.0 - SDR Video');
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(info.url).toContain(lutStorageKey(CONFIG_ID, 'sRGB - Display', 'ACES 1.0 - SDR Video'));
  });

  it('a non-baked tone-mapped view asks the worker rather than an approximation', async () => {
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

/**
 * A2-03 — The installation downloads from GitHub, which serves its assets through a redirect. The allow-list
 * was only checked on the STARTING URL: `fetch` then followed the 302 blindly,
 * all the way to an internal address. These tests exercise the real exit guard (`fetchAllowlisted`), with
 * only the global `fetch` as a double.
 */
describe('OcioService: install: hardened exit (A2-03)', () => {
  const TAG = 'v2.1.0';
  const ASSET = 'studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio';
  const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

  let fetchMock: Mock<typeof fetch>;

  /** First call: the releases JSON. The following ones: whatever the scenario requires. */
  const withDownload = (...responses: Response[]) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([release(TAG, [ASSET])]), { status: 200 }));
    for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  };

  const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

  beforeEach(() => {
    vi.clearAllMocks();
    __resetReleasesCache();
    vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
    findUniqueMock.mockResolvedValue(null); // empty library
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('installs the asset by following the redirect to the GitHub content host', async () => {
    withDownload(
      redirectTo('https://objects.githubusercontent.com/a'),
      new Response('ocio_profile_version: 2', { status: 200 }),
    );
    const entry = await install(TAG, ASSET);
    expect(entry.assetName).toBe(ASSET);
    expect(storageMock.putObject).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3); // releases + start + hop
  });

  it('refuses a redirect to cloud metadata, and writes nothing into MinIO', async () => {
    withDownload(redirectTo('http://169.254.169.254/latest/meta-data/iam/'));
    await expect(install(TAG, ASSET)).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
    // The internal hop was never emitted: releases + start, nothing more.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect to MinIO on the application network', async () => {
    withDownload(redirectTo('http://10.0.0.9:9000/review/'));
    await expect(install(TAG, ASSET)).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it('refuses a redirect to a public host outside the allow-list', async () => {
    withDownload(redirectTo('https://evil.test/collect'));
    await expect(install(TAG, ASSET)).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it('refuses a body exceeding the ceiling before loading it into memory', async () => {
    withDownload(new Response('x', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024) } }));
    await expect(install(TAG, ASSET)).rejects.toMatchObject({ code: 'OUTBOUND_TOO_LARGE' });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it('sets an abort signal on each outgoing request', async () => {
    withDownload(new Response('ocio_profile_version: 2', { status: 200 }));
    await install(TAG, ASSET);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe('manual');
    }
  });
});
