// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { MediaKind } from '@prisma/client';
import {
  detectVideo,
  detectImage,
  detectProductionImage,
  detect3D,
  detectSplat,
  inferKindFromExtension,
  isSupportedExtension,
  SUPPORTED_EXTENSIONS,
  validateMediaHeader,
  getExtension,
} from './fileSignatures';

const buf = (...bytes: number[]) => Buffer.from(bytes);
/** Pads a fabricated header up to the 32-byte window actually read in production. */
const head = (...bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * 18-byte TGA header (Truevision TGA 2.0): no palette, uncompressed RGB image (type 2), 64×32, 24 bits per pixel.
 */
const tgaHeader = () => head(0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 32, 0, 24, 0);

describe('detectImage', () => {
  it('recognises a JPG', () => {
    expect(detectImage(buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.jpg');
  });
  it('recognises a PNG', () => {
    expect(detectImage(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe('.png');
  });
  it('recognises a WEBP', () => {
    expect(detectImage(buf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('.webp');
  });
  it('rejects an unknown buffer', () => {
    expect(detectImage(buf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))).toBeNull();
  });
});

describe('detectProductionImage', () => {
  // OpenEXR "File Layout": magic number 20000630 = 0x01312F76, written little-endian.
  it('recognises an EXR (76 2F 31 01)', () => {
    expect(detectProductionImage(head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000_000)).toBe('.exr');
    // The same number read backwards is not an EXR.
    expect(detectProductionImage(head(0x01, 0x31, 0x2f, 0x76), '.exr', 4_000_000)).toBeNull();
  });

  // SMPTE ST 268-1: "SDPX" (big-endian) or "XPDS" (little-endian).
  it('recognises a DPX in both byte orders', () => {
    expect(detectProductionImage(head(...chars('SDPX')), '.dpx', 12_000_000)).toBe('.dpx');
    expect(detectProductionImage(head(...chars('XPDS')), '.dpx', 12_000_000)).toBe('.dpx');
  });

  // TIFF 6.0 §2: "II" + 42 (little-endian) or "MM" + 42 (big-endian).
  it('recognises a classic TIFF, refuses BigTIFF (version 43, not decoded by FFmpeg)', () => {
    expect(detectProductionImage(head(0x49, 0x49, 0x2a, 0x00), '.tif', 900_000)).toBe('.tif');
    expect(detectProductionImage(head(0x4d, 0x4d, 0x00, 0x2a), '.tiff', 900_000)).toBe('.tif');
    expect(detectProductionImage(head(0x49, 0x49, 0x2b, 0x00), '.tif', 900_000)).toBeNull();
  });

  it('recognises a BMP ("BM") and a GIF ("GIF87a"/"GIF89a")', () => {
    expect(detectProductionImage(head(...chars('BM')), '.bmp', 1000)).toBe('.bmp');
    expect(detectProductionImage(head(...chars('GIF89a')), '.gif', 1000)).toBe('.gif');
    expect(detectProductionImage(head(...chars('GIF87a')), '.gif', 1000)).toBe('.gif');
    expect(detectProductionImage(head(...chars('GIF80a')), '.gif', 1000)).toBeNull();
  });

  // TGA has no leading signature (its mark is a file footer): we validate the 18-byte header, field by
  // field, in addition to the extension.
  it("recognises a TGA by the consistency of its header, never by the extension alone", () => {
    expect(detectProductionImage(tgaHeader(), '.tga', 6144)).toBe('.tga');
    // No extension: nothing distinguishes these bytes from an arbitrary binary any more.
    expect(detectProductionImage(tgaHeader(), null, 6144)).toBeNull();
    // Image type 7: does not exist in the specification.
    const badType = tgaHeader();
    badType[2] = 7;
    expect(detectProductionImage(badType, '.tga', 6144)).toBeNull();
    // 12-bit depth: outside the accepted values (1, 8, 15, 16, 24, 32).
    const badDepth = tgaHeader();
    badDepth[16] = 12;
    expect(detectProductionImage(badDepth, '.tga', 6144)).toBeNull();
    // Null dimensions.
    const empty = tgaHeader();
    empty[12] = 0;
    empty[13] = 0;
    expect(detectProductionImage(empty, '.tga', 6144)).toBeNull();
  });

  it('rejects unknown content', () => {
    expect(detectProductionImage(head(0, 1, 2, 3, 4, 5), '.exr', 100)).toBeNull();
  });
});

describe('detectVideo', () => {
  it('recognises an MP4 (ftyp)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('.mp4');
  });
  it('recognises a MOV (qt brand)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20))).toBe('.mov');
  });
  it('recognises a WEBM', () => {
    expect(detectVideo(buf(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.webm');
  });

  // RIFF: "RIFF" at 0, form type "AVI " (with its space) at 8.
  it('recognises an AVI and does not confuse it with a WEBP', () => {
    expect(detectVideo(head(...chars('RIFF'), 0, 0, 0, 0, ...chars('AVI ')))).toBe('.avi');
    expect(detectVideo(head(...chars('RIFF'), 0, 0, 0, 0, ...chars('WEBP')))).toBeNull();
  });

  // SMPTE ST 377-1: key of the Header Partition Pack, first 11 bytes stable.
  it("recognises an MXF by the key of its header partition", () => {
    const key = [
      0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01, 0x02, 0x04, 0x00,
    ];
    expect(detectVideo(head(...key))).toBe('.mxf');
    // A SMPTE key from another family (different 5th byte) is not an MXF partition.
    const other = [...key];
    other[4] = 0x01;
    expect(detectVideo(head(...other))).toBeNull();
  });

  // ISO/IEC 13818-1: 188-byte packets opened by 0x47; M2TS shifts by 4 bytes.
  it('recognises an MPEG-TS and an M2TS, with the extension as support', () => {
    expect(detectVideo(head(0x47, 0x40, 0x00, 0x10), '.ts')).toBe('.ts');
    expect(detectVideo(head(0, 0, 0, 0, 0x47, 0x40, 0x00, 0x10), '.m2ts')).toBe('.m2ts');
    // Without an extension, a lone 0x47 byte proves nothing.
    expect(detectVideo(head(0x47, 0x40, 0x00, 0x10), null)).toBeNull();
    // transport_error_indicator set: packet declared corrupt by the standard itself.
    expect(detectVideo(head(0x47, 0xc0, 0x00, 0x10), '.ts')).toBeNull();
  });
});

describe('detect3D', () => {
  it('recognises a GLB', () => {
    expect(detect3D(buf(0x67, 0x6c, 0x54, 0x46), null, 100)).toBe('.glb');
  });
  it('recognises a 3D ZIP archive (PK + .zip hint)', () => {
    expect(detect3D(buf(0x50, 0x4b, 0x03, 0x04), '.zip', 500)).toBe('.zip');
    expect(detect3D(buf(0, 0, 0, 0), '.zip', 500)).toBeNull();
  });
  it('recognises a glTF JSON (hint + first character {)', () => {
    expect(detect3D(buf(0x7b, 0x22, 0x61, 0x22), '.gltf', 100)).toBe('.gltf');
  });
  it('recognises an OBJ by hint + size (converted to GLB afterwards)', () => {
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 200)).toBe('.obj');
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 0)).toBeNull();
  });
});

describe('detectSplat', () => {
  it('recognises a PLY (magic "ply\\n", including compressed)', () => {
    expect(detectSplat(buf(0x70, 0x6c, 0x79, 0x0a), '.ply', 1000)).toBe('.ply');
    expect(detectSplat(buf(0x70, 0x6c, 0x79, 0x0d), '.ply', 1000)).toBe('.ply');
  });
  it('recognises an SPZ (gzip 1F 8B + .spz hint)', () => {
    expect(detectSplat(buf(0x1f, 0x8b, 0x08, 0), '.spz', 5000)).toBe('.spz');
    expect(detectSplat(buf(0, 0, 0, 0), '.spz', 5000)).toBeNull();
  });
  it('recognises a SPLAT by hint + size multiple of 32', () => {
    expect(detectSplat(buf(1, 2, 3, 4), '.splat', 64)).toBe('.splat');
    expect(detectSplat(buf(1, 2, 3, 4), '.splat', 65)).toBeNull();
  });
  it('recognises KSPLAT / SOG / SOGS by hint + size', () => {
    expect(detectSplat(buf(1, 2, 3, 4), '.ksplat', 500)).toBe('.ksplat');
    expect(detectSplat(buf(1, 2, 3, 4), '.sog', 500)).toBe('.sog');
    expect(detectSplat(buf(1, 2, 3, 4), '.sogs', 500)).toBe('.sogs');
    expect(detectSplat(buf(1, 2, 3, 4), '.sog', 0)).toBeNull();
  });
  it('rejects an unknown format', () => {
    expect(detectSplat(buf(0, 1, 2, 3), '.txt', 100)).toBeNull();
  });
});

describe('validateMediaHeader', () => {
  it('validates according to the expected kind', () => {
    expect(
      validateMediaHeader(MediaKind.IMAGE, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100),
    ).toBe('.jpg');
    expect(
      validateMediaHeader(MediaKind.VIDEO, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100),
    ).toBeNull();
    expect(validateMediaHeader(MediaKind.SPLAT, buf(0x70, 0x6c, 0x79, 0x0a), '.ply', 100)).toBe('.ply');
  });

  it('accepts production images under the same IMAGE kind', () => {
    expect(validateMediaHeader(MediaKind.IMAGE, head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000_000)).toBe(
      '.exr',
    );
    expect(validateMediaHeader(MediaKind.IMAGE, head(...chars('SDPX')), '.dpx', 12_000_000)).toBe('.dpx');
    expect(validateMediaHeader(MediaKind.IMAGE, tgaHeader(), '.tga', 6144)).toBe('.tga');
  });

  it('an EXR is still refused if the client declares it VIDEO', () => {
    expect(validateMediaHeader(MediaKind.VIDEO, head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000)).toBeNull();
  });
});

/**
 * The original defect: the extension table published by the v1 API promised formats that header
 * validation refused, *after* the full transfer of the file. This block locks the invariant: anything
 * announced must be recognisable.
 */
describe('SUPPORTED_EXTENSIONS', () => {
  const sample: Record<string, { buf: Buffer; size: number }> = {
    '.mp4': { buf: head(0, 0, 0, 0, ...chars('ftypisom')), size: 1000 },
    '.m4v': { buf: head(0, 0, 0, 0, ...chars('ftypM4V ')), size: 1000 },
    '.mov': { buf: head(0, 0, 0, 0, ...chars('ftypqt  ')), size: 1000 },
    '.mkv': { buf: head(0x1a, 0x45, 0xdf, 0xa3), size: 1000 },
    '.webm': { buf: head(0x1a, 0x45, 0xdf, 0xa3), size: 1000 },
    '.avi': { buf: head(...chars('RIFF'), 0, 0, 0, 0, ...chars('AVI ')), size: 1000 },
    '.mxf': { buf: head(0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02), size: 1000 },
    '.ts': { buf: head(0x47, 0x40, 0x00, 0x10), size: 1000 },
    '.m2ts': { buf: head(0, 0, 0, 0, 0x47, 0x40, 0x00, 0x10), size: 1000 },
    '.mts': { buf: head(0, 0, 0, 0, 0x47, 0x40, 0x00, 0x10), size: 1000 },
    '.jpg': { buf: head(0xff, 0xd8, 0xff), size: 1000 },
    '.jpeg': { buf: head(0xff, 0xd8, 0xff), size: 1000 },
    '.png': { buf: head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), size: 1000 },
    '.webp': { buf: head(...chars('RIFF'), 0, 0, 0, 0, ...chars('WEBP')), size: 1000 },
    '.gif': { buf: head(...chars('GIF89a')), size: 1000 },
    '.bmp': { buf: head(...chars('BM')), size: 1000 },
    '.exr': { buf: head(0x76, 0x2f, 0x31, 0x01), size: 1000 },
    '.dpx': { buf: head(...chars('SDPX')), size: 1000 },
    '.tif': { buf: head(0x49, 0x49, 0x2a, 0x00), size: 1000 },
    '.tiff': { buf: head(0x4d, 0x4d, 0x00, 0x2a), size: 1000 },
    '.tga': { buf: tgaHeader(), size: 6144 },
    '.glb': { buf: head(...chars('glTF')), size: 1000 },
    '.gltf': { buf: head(...chars('{"a"')), size: 1000 },
    '.fbx': { buf: head(...chars('Kaydara FBX Binary')), size: 1000 },
    '.obj': { buf: head(...chars('v 0 0')), size: 1000 },
    '.usd': { buf: head(...chars('#usda')), size: 1000 },
    '.usda': { buf: head(...chars('#usda')), size: 1000 },
    '.usdc': { buf: head(...chars('PXR-USDC')), size: 1000 },
    '.usdz': { buf: head(0x50, 0x4b, 0x03, 0x04), size: 1000 },
    '.dae': { buf: head(...chars('<?xml')), size: 1000 },
    '.stl': { buf: head(...chars('solid')), size: 1000 },
    '.zip': { buf: head(0x50, 0x4b, 0x03, 0x04), size: 1000 },
    '.ply': { buf: head(...chars('ply\n')), size: 1000 },
    '.splat': { buf: head(1, 2, 3, 4), size: 64 },
    '.spz': { buf: head(0x1f, 0x8b), size: 1000 },
    '.ksplat': { buf: head(1, 2, 3, 4), size: 1000 },
    '.sog': { buf: head(1, 2, 3, 4), size: 1000 },
    '.sogs': { buf: head(1, 2, 3, 4), size: 1000 },
  };

  for (const kind of [MediaKind.VIDEO, MediaKind.IMAGE, MediaKind.MODEL_3D, MediaKind.SPLAT]) {
    for (const ext of SUPPORTED_EXTENSIONS[kind]) {
      it(`${kind} ${ext}: announced, hence recognised at finalisation`, () => {
        const fixture = sample[ext];
        expect(fixture, `aucun en-tête d'exemple pour ${ext}`).toBeDefined();
        expect(validateMediaHeader(kind, fixture!.buf, ext, fixture!.size)).not.toBeNull();
      });
    }
  }

  it('derives the carrying type from an extension, and refuses the rest', () => {
    expect(inferKindFromExtension('.exr')).toBe(MediaKind.IMAGE);
    expect(inferKindFromExtension('.mxf')).toBe(MediaKind.VIDEO);
    expect(inferKindFromExtension('.usdz')).toBe(MediaKind.MODEL_3D);
    expect(inferKindFromExtension('.spz')).toBe(MediaKind.SPLAT);
    expect(inferKindFromExtension('.txt')).toBeNull();
    // Alembic: removed as long as no signature or converter supports it.
    expect(inferKindFromExtension('.abc')).toBeNull();
  });

  it('no extension is claimed by two types at once', () => {
    const seen = new Set<string>();
    for (const list of Object.values(SUPPORTED_EXTENSIONS)) {
      for (const ext of list) {
        expect(seen.has(ext), `${ext} apparaît dans deux types`).toBe(false);
        seen.add(ext);
      }
    }
  });

  it('isSupportedExtension reasons by type', () => {
    expect(isSupportedExtension(MediaKind.IMAGE, '.exr')).toBe(true);
    expect(isSupportedExtension(MediaKind.VIDEO, '.exr')).toBe(false);
  });
});

/**
 * Counter-check on RECORDED bytes, not deduced from a reading of the specification: these are the first 32
 * bytes of files actually written by the FFmpeg 5.1 of the worker image (`ffmpeg -f lavfi -i testsrc2 ...`).
 * A signature right on paper and wrong in the field would show up here, and nowhere else before production.
 */
describe('headers recorded from real files', () => {
  /** The 32 recorded bytes, as displayed by `od -An -tx1`. */
  const bytes = (dump: string) => Buffer.from(dump.replace(/\s+/g, ''), 'hex');

  const real: [MediaKind, string, string][] = [
    [
      MediaKind.IMAGE,
      '.exr',
      '76 2f 31 01 02 00 00 00 63 68 61 6e 6e 65 6c 73 00 63 68 6c 69 73 74 00 37 00 00 00 42 00 02 00',
    ],
    [
      MediaKind.IMAGE,
      '.dpx',
      '58 50 44 53 80 06 00 00 56 31 2e 30 00 00 00 00 80 f2 5e 00 01 00 00 00 80 06 00 00 00 00 00 00',
    ],
    [
      MediaKind.IMAGE,
      '.tif',
      '49 49 2a 00 ca e6 05 00 fd 4a 01 dd a6 fd 4a 01 dd a6 fd 4a 01 dd a6 fd 4a 01 dd a6 fd 51 01 5a',
    ],
    [
      MediaKind.IMAGE,
      '.bmp',
      '42 4d 36 30 00 00 00 00 00 00 36 00 00 00 28 00 00 00 40 00 00 00 40 00 00 00 01 00 18 00 00 00',
    ],
    [
      MediaKind.IMAGE,
      '.gif',
      '47 49 46 38 39 61 40 00 40 00 f7 1f 31 00 00 00 24 00 00 48 00 00 6c 00 00 90 00 00 b4 00 00 d8',
    ],
    [
      MediaKind.IMAGE,
      '.tga',
      '00 00 0a 00 00 00 00 00 00 00 00 00 80 02 e0 01 18 20 87 fe 00 7f e3 00 00 fd e9 00 fe 00 e9 00',
    ],
    [
      MediaKind.VIDEO,
      '.mxf',
      '06 0e 2b 34 02 05 01 01 0d 01 02 01 01 02 04 00 83 00 00 88 00 01 00 03 00 00 02 00 00 00 00 00',
    ],
    [
      MediaKind.VIDEO,
      '.avi',
      '52 49 46 46 d4 7c 02 00 41 56 49 20 4c 49 53 54 38 12 00 00 68 64 72 6c 61 76 69 68 38 00 00 00',
    ],
    [
      MediaKind.VIDEO,
      '.ts',
      '47 40 11 10 00 42 f0 25 00 01 c1 00 00 ff 01 ff 00 01 fc 80 14 48 12 01 06 46 46 6d 70 65 67 09',
    ],
    [
      MediaKind.VIDEO,
      '.mov',
      '00 00 00 14 66 74 79 70 71 74 20 20 00 00 02 00 71 74 20 20 00 00 00 08 77 69 64 65 00 7a 46 70',
    ],
  ];

  for (const [kind, ext, dump] of real) {
      it(`${ext}: the file written by FFmpeg is recognised`, () => {
      // 63,374 = actual size of the recorded TGA; the other formats do not depend on it.
      expect(validateMediaHeader(kind, bytes(dump), ext, 63_374)).toBe(ext);
    });
  }

  it('the recorded TGA indeed carries the announced dimensions (640×480, 24 bits)', () => {
    const tga = bytes(real.find(([, ext]) => ext === '.tga')![2]);
    expect(tga[12]! | (tga[13]! << 8)).toBe(640);
    expect(tga[14]! | (tga[15]! << 8)).toBe(480);
    expect(tga[16]).toBe(24);
  });
});

describe('getExtension', () => {
  it("extracts the extension in lowercase", () => {
    expect(getExtension('Scene.GLB')).toBe('.glb');
    expect(getExtension('noext')).toBe('');
  });
});
