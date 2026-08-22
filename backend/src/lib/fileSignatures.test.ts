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
/** Complète un en-tête fabriqué jusqu'à la fenêtre de 32 octets réellement lue en production. */
const head = (...bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * En-tête TGA de 18 octets (Truevision TGA 2.0) : pas de palette, image RVB non
 * compressée (type 2), 64×32, 24 bits par pixel.
 */
const tgaHeader = () => head(0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 32, 0, 24, 0);

describe('detectImage', () => {
  it('reconnaît un JPG', () => {
    expect(detectImage(buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.jpg');
  });
  it('reconnaît un PNG', () => {
    expect(detectImage(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe('.png');
  });
  it('reconnaît un WEBP', () => {
    expect(detectImage(buf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('.webp');
  });
  it('rejette un buffer inconnu', () => {
    expect(detectImage(buf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))).toBeNull();
  });
});

describe('detectProductionImage', () => {
  // OpenEXR « File Layout » : nombre magique 20000630 = 0x01312F76, écrit en petit-boutien.
  it('reconnaît un EXR (76 2F 31 01)', () => {
    expect(detectProductionImage(head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000_000)).toBe('.exr');
    // Le même nombre lu à l'envers n'est pas un EXR.
    expect(detectProductionImage(head(0x01, 0x31, 0x2f, 0x76), '.exr', 4_000_000)).toBeNull();
  });

  // SMPTE ST 268-1 : « SDPX » (gros-boutien) ou « XPDS » (petit-boutien).
  it('reconnaît un DPX dans les deux boutismes', () => {
    expect(detectProductionImage(head(...chars('SDPX')), '.dpx', 12_000_000)).toBe('.dpx');
    expect(detectProductionImage(head(...chars('XPDS')), '.dpx', 12_000_000)).toBe('.dpx');
  });

  // TIFF 6.0 §2 : « II » + 42 (petit-boutien) ou « MM » + 42 (gros-boutien).
  it('reconnaît un TIFF classique, refuse BigTIFF (version 43, non décodé par FFmpeg)', () => {
    expect(detectProductionImage(head(0x49, 0x49, 0x2a, 0x00), '.tif', 900_000)).toBe('.tif');
    expect(detectProductionImage(head(0x4d, 0x4d, 0x00, 0x2a), '.tiff', 900_000)).toBe('.tif');
    expect(detectProductionImage(head(0x49, 0x49, 0x2b, 0x00), '.tif', 900_000)).toBeNull();
  });

  it('reconnaît un BMP (« BM ») et un GIF (« GIF87a »/« GIF89a »)', () => {
    expect(detectProductionImage(head(...chars('BM')), '.bmp', 1000)).toBe('.bmp');
    expect(detectProductionImage(head(...chars('GIF89a')), '.gif', 1000)).toBe('.gif');
    expect(detectProductionImage(head(...chars('GIF87a')), '.gif', 1000)).toBe('.gif');
    expect(detectProductionImage(head(...chars('GIF80a')), '.gif', 1000)).toBeNull();
  });

  // TGA n'a pas de signature en tête (sa marque est un pied de fichier) : on valide
  // l'en-tête de 18 octets, champ par champ, en plus de l'extension.
  it("reconnaît un TGA par la cohérence de son en-tête, jamais par l'extension seule", () => {
    expect(detectProductionImage(tgaHeader(), '.tga', 6144)).toBe('.tga');
    // Extension absente : rien ne distingue plus ces octets d'un binaire quelconque.
    expect(detectProductionImage(tgaHeader(), null, 6144)).toBeNull();
    // Type d'image 7 : inexistant dans la spécification.
    const badType = tgaHeader();
    badType[2] = 7;
    expect(detectProductionImage(badType, '.tga', 6144)).toBeNull();
    // Profondeur 12 bits : hors des valeurs admises (1, 8, 15, 16, 24, 32).
    const badDepth = tgaHeader();
    badDepth[16] = 12;
    expect(detectProductionImage(badDepth, '.tga', 6144)).toBeNull();
    // Dimensions nulles.
    const empty = tgaHeader();
    empty[12] = 0;
    empty[13] = 0;
    expect(detectProductionImage(empty, '.tga', 6144)).toBeNull();
  });

  it('rejette un contenu inconnu', () => {
    expect(detectProductionImage(head(0, 1, 2, 3, 4, 5), '.exr', 100)).toBeNull();
  });
});

describe('detectVideo', () => {
  it('reconnaît un MP4 (ftyp)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('.mp4');
  });
  it('reconnaît un MOV (qt brand)', () => {
    expect(detectVideo(buf(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20))).toBe('.mov');
  });
  it('reconnaît un WEBM', () => {
    expect(detectVideo(buf(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('.webm');
  });

  // RIFF : « RIFF » à 0, type de forme « AVI » (avec son espace) à 8.
  it('reconnaît un AVI et ne le confond pas avec un WEBP', () => {
    expect(detectVideo(head(...chars('RIFF'), 0, 0, 0, 0, ...chars('AVI ')))).toBe('.avi');
    expect(detectVideo(head(...chars('RIFF'), 0, 0, 0, 0, ...chars('WEBP')))).toBeNull();
  });

  // SMPTE ST 377-1 : clé du Header Partition Pack, 11 premiers octets stables.
  it('reconnaît un MXF par la clé de sa partition dʼen-tête', () => {
    const key = [
      0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01, 0x02, 0x04, 0x00,
    ];
    expect(detectVideo(head(...key))).toBe('.mxf');
    // Une clé SMPTE d'une autre famille (5e octet différent) n'est pas une partition MXF.
    const other = [...key];
    other[4] = 0x01;
    expect(detectVideo(head(...other))).toBeNull();
  });

  // ISO/IEC 13818-1 : paquets de 188 octets ouverts par 0x47 ; M2TS décale de 4 octets.
  it('reconnaît un MPEG-TS et un M2TS, extension à lʼappui', () => {
    expect(detectVideo(head(0x47, 0x40, 0x00, 0x10), '.ts')).toBe('.ts');
    expect(detectVideo(head(0, 0, 0, 0, 0x47, 0x40, 0x00, 0x10), '.m2ts')).toBe('.m2ts');
    // Sans extension, un octet 0x47 isolé ne prouve rien.
    expect(detectVideo(head(0x47, 0x40, 0x00, 0x10), null)).toBeNull();
    // transport_error_indicator armé : paquet déclaré corrompu par la norme elle-même.
    expect(detectVideo(head(0x47, 0xc0, 0x00, 0x10), '.ts')).toBeNull();
  });
});

describe('detect3D', () => {
  it('reconnaît un GLB', () => {
    expect(detect3D(buf(0x67, 0x6c, 0x54, 0x46), null, 100)).toBe('.glb');
  });
  it('reconnaît une archive ZIP 3D (PK + hint .zip)', () => {
    expect(detect3D(buf(0x50, 0x4b, 0x03, 0x04), '.zip', 500)).toBe('.zip');
    expect(detect3D(buf(0, 0, 0, 0), '.zip', 500)).toBeNull();
  });
  it('reconnaît un glTF JSON (hint + premier caractère {)', () => {
    expect(detect3D(buf(0x7b, 0x22, 0x61, 0x22), '.gltf', 100)).toBe('.gltf');
  });
  it('reconnaît un OBJ par hint + taille (converti en GLB ensuite)', () => {
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 200)).toBe('.obj');
    expect(detect3D(buf(0x76, 0x20, 0x30, 0x20), '.obj', 0)).toBeNull();
  });
});

describe('detectSplat', () => {
  it('reconnaît un PLY (magic « ply\\n », dont compressé)', () => {
    expect(detectSplat(buf(0x70, 0x6c, 0x79, 0x0a), '.ply', 1000)).toBe('.ply');
    expect(detectSplat(buf(0x70, 0x6c, 0x79, 0x0d), '.ply', 1000)).toBe('.ply');
  });
  it('reconnaît un SPZ (gzip 1F 8B + hint .spz)', () => {
    expect(detectSplat(buf(0x1f, 0x8b, 0x08, 0), '.spz', 5000)).toBe('.spz');
    expect(detectSplat(buf(0, 0, 0, 0), '.spz', 5000)).toBeNull();
  });
  it('reconnaît un SPLAT par hint + taille multiple de 32', () => {
    expect(detectSplat(buf(1, 2, 3, 4), '.splat', 64)).toBe('.splat');
    expect(detectSplat(buf(1, 2, 3, 4), '.splat', 65)).toBeNull();
  });
  it('reconnaît KSPLAT / SOG / SOGS par hint + taille', () => {
    expect(detectSplat(buf(1, 2, 3, 4), '.ksplat', 500)).toBe('.ksplat');
    expect(detectSplat(buf(1, 2, 3, 4), '.sog', 500)).toBe('.sog');
    expect(detectSplat(buf(1, 2, 3, 4), '.sogs', 500)).toBe('.sogs');
    expect(detectSplat(buf(1, 2, 3, 4), '.sog', 0)).toBeNull();
  });
  it('rejette un format inconnu', () => {
    expect(detectSplat(buf(0, 1, 2, 3), '.txt', 100)).toBeNull();
  });
});

describe('validateMediaHeader', () => {
  it('valide selon le kind attendu', () => {
    expect(
      validateMediaHeader(MediaKind.IMAGE, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100),
    ).toBe('.jpg');
    expect(
      validateMediaHeader(MediaKind.VIDEO, buf(0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0), '.jpg', 100),
    ).toBeNull();
    expect(validateMediaHeader(MediaKind.SPLAT, buf(0x70, 0x6c, 0x79, 0x0a), '.ply', 100)).toBe('.ply');
  });

  it('accepte les images de production sous le même kind IMAGE', () => {
    expect(validateMediaHeader(MediaKind.IMAGE, head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000_000)).toBe(
      '.exr',
    );
    expect(validateMediaHeader(MediaKind.IMAGE, head(...chars('SDPX')), '.dpx', 12_000_000)).toBe('.dpx');
    expect(validateMediaHeader(MediaKind.IMAGE, tgaHeader(), '.tga', 6144)).toBe('.tga');
  });

  it('un EXR reste refusé si le client le déclare VIDEO', () => {
    expect(validateMediaHeader(MediaKind.VIDEO, head(0x76, 0x2f, 0x31, 0x01), '.exr', 4_000)).toBeNull();
  });
});

/**
 * Le défaut d'origine : la table d'extensions publiée par l'API v1 promettait des formats
 * que la validation d'en-tête refusait, *après* le transfert complet du fichier. Ce bloc
 * verrouille l'invariant — tout ce qui est annoncé doit être reconnaissable.
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
      it(`${kind} ${ext} : annoncé, donc reconnu à la finalisation`, () => {
        const fixture = sample[ext];
        expect(fixture, `aucun en-tête d'exemple pour ${ext}`).toBeDefined();
        expect(validateMediaHeader(kind, fixture!.buf, ext, fixture!.size)).not.toBeNull();
      });
    }
  }

  it('déduit le type porteur d’une extension, et refuse le reste', () => {
    expect(inferKindFromExtension('.exr')).toBe(MediaKind.IMAGE);
    expect(inferKindFromExtension('.mxf')).toBe(MediaKind.VIDEO);
    expect(inferKindFromExtension('.usdz')).toBe(MediaKind.MODEL_3D);
    expect(inferKindFromExtension('.spz')).toBe(MediaKind.SPLAT);
    expect(inferKindFromExtension('.txt')).toBeNull();
    // Alembic : retiré tant qu'aucune signature ni aucun convertisseur ne le prend en charge.
    expect(inferKindFromExtension('.abc')).toBeNull();
  });

  it('aucune extension n’est revendiquée par deux types à la fois', () => {
    const seen = new Set<string>();
    for (const list of Object.values(SUPPORTED_EXTENSIONS)) {
      for (const ext of list) {
        expect(seen.has(ext), `${ext} apparaît dans deux types`).toBe(false);
        seen.add(ext);
      }
    }
  });

  it('isSupportedExtension raisonne par type', () => {
    expect(isSupportedExtension(MediaKind.IMAGE, '.exr')).toBe(true);
    expect(isSupportedExtension(MediaKind.VIDEO, '.exr')).toBe(false);
  });
});

/**
 * Contre-épreuve sur des octets **relevés**, non déduits d'une lecture de spécification :
 * ce sont les 32 premiers octets de fichiers réellement écrits par le FFmpeg 5.1 de
 * l'image du worker (`ffmpeg -f lavfi -i testsrc2 …`). Une signature juste sur le papier et
 * fausse sur le terrain se verrait ici, et nulle part ailleurs avant la production.
 */
describe('en-têtes relevés sur des fichiers réels', () => {
  /** Les 32 octets relevés, tels que `od -An -tx1` les a affichés. */
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
    it(`${ext} : le fichier écrit par FFmpeg est reconnu`, () => {
      // 63 374 = taille réelle du TGA relevé ; les autres formats n'en dépendent pas.
      expect(validateMediaHeader(kind, bytes(dump), ext, 63_374)).toBe(ext);
    });
  }

  it('le TGA relevé porte bien les dimensions annoncées (640×480, 24 bits)', () => {
    const tga = bytes(real.find(([, ext]) => ext === '.tga')![2]);
    expect(tga[12]! | (tga[13]! << 8)).toBe(640);
    expect(tga[14]! | (tga[15]! << 8)).toBe(480);
    expect(tga[16]).toBe(24);
  });
});

describe('getExtension', () => {
  it("extrait l'extension en minuscules", () => {
    expect(getExtension('Scene.GLB')).toBe('.glb');
    expect(getExtension('noext')).toBe('');
  });
});
