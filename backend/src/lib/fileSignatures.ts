// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Validation MIME réelle par magic bytes (porté de utils/validation.js v1).
 *
 * En v2 les fichiers vivent dans MinIO : on valide à partir d'un buffer d'en-tête
 * (les ~32 premiers octets lus depuis l'objet stocké), pas depuis le filesystem local.
 *
 * **Contrainte structurante** : `MediaService.finalize` ne lit que 32 octets. Toute
 * signature ajoutée ici doit donc tenir dans cette fenêtre — c'est ce qui exclut le pied
 * de fichier TGA (« TRUEVISION-XFILE. », en fin d'objet) et impose de valider ce format
 * par la cohérence de son en-tête de 18 octets.
 *
 * Les octets ne sont jamais devinés : chaque signature porte la référence de la
 * spécification dont elle est tirée.
 */

import { MediaKind } from '@prisma/client';

const ascii = (buf: Buffer, start: number, end: number): string => buf.toString('utf8', start, end);

/** Compare une séquence d'octets à l'offset donné. */
const magic = (buf: Buffer, offset: number, bytes: number[]): boolean => {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
};

/* ────────────────────────────── Vidéo ────────────────────────────── */

/**
 * Conteneurs vidéo à signature stable : Matroska/WebM, ISOBMFF (MP4/MOV/M4V),
 * AVI (RIFF) et MXF (SMPTE ST 377-1).
 */
const detectVideoContainer = (buf: Buffer): string | null => {
  // WEBM/MKV — EBML, RFC 8794 §4.1 : 1A 45 DF A3.
  if (magic(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return '.webm';
  // AVI — RIFF (Microsoft Multimedia) : « RIFF » à 0, type de forme « AVI » à 8.
  // Contrôlé AVANT ISOBMFF : les deux familles ne se recouvrent pas, mais l'ordre rend
  // la lecture du code indépendante de l'ordre des `if`.
  if (magic(buf, 0, [0x52, 0x49, 0x46, 0x46]) && magic(buf, 8, [0x41, 0x56, 0x49, 0x20])) return '.avi';
  // MXF — SMPTE ST 377-1 : le fichier s'ouvre sur le Header Partition Pack, dont la clé
  // universelle commence par 06 0E 2B 34 02 05 01 01 0D 01 02 (11 octets stables, quel que
  // soit le type de partition). Réserve assumée : un fichier précédé d'une séquence de
  // « run-in » (autorisée jusqu'à 64 ko par la norme, jamais écrite par les caméras et les
  // stations de montage) n'est pas reconnu dans une fenêtre de 32 octets.
  if (magic(buf, 0, [0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02])) return '.mxf';
  // MP4/MOV/M4V — ISO/IEC 14496-12 : boîte « ftyp » à l'offset 4.
  if (magic(buf, 4, [0x66, 0x74, 0x79, 0x70])) {
    // QuickTime « qt  » en major brand → .mov (c'est le conteneur des masters ProRes).
    if (magic(buf, 8, [0x71, 0x74, 0x20, 0x20])) return '.mov';
    return '.mp4';
  }
  return null;
};

/**
 * MPEG-TS — ISO/IEC 13818-1 : suite de paquets de 188 octets ouverts par l'octet de
 * synchronisation 0x47 ; la variante M2TS/BDAV préfixe chaque paquet de 4 octets de
 * timecode, l'octet de synchro tombe alors à l'offset 4.
 *
 * Un seul octet ne fait pas une signature : on exige donc **aussi** l'extension d'origine
 * et un `transport_error_indicator` (bit de poids fort de l'octet suivant la synchro) à
 * zéro, comme l'impose la norme pour un paquet non corrompu. Le contrôle complet
 * (synchro retrouvée tous les 188 octets) demanderait de lire le fichier, pas son en-tête.
 */
const detectTransportStream = (buf: Buffer, hintExt: string | null): string | null => {
  const at = (offset: number): boolean =>
    buf.length > offset + 1 && buf[offset] === 0x47 && (buf[offset + 1]! & 0x80) === 0;
  if (hintExt === '.ts' && at(0)) return '.ts';
  if ((hintExt === '.m2ts' || hintExt === '.mts') && at(4)) return hintExt;
  return null;
};

/** Vidéo : MP4, MOV, M4V, WEBM/MKV, AVI, MXF, MPEG-TS. Extension canonique ou null. */
export const detectVideo = (buf: Buffer, hintExt: string | null = null): string | null => {
  if (buf.length < 12) return null;
  return detectVideoContainer(buf) ?? detectTransportStream(buf, hintExt);
};

/* ────────────────────────────── Image ────────────────────────────── */

/**
 * Image affichable telle quelle par un navigateur : JPG, PNG, WEBP.
 *
 * Volontairement restreinte : c'est cette fonction que `MediaService` utilise pour
 * contrôler une miniature déposée en data URL, où seuls ces trois types sont acceptés.
 * Les formats de production passent par `detectProductionImage`.
 */
export const detectImage = (buf: Buffer): string | null => {
  if (buf.length < 12) return null;
  // JPEG — ITU-T T.81 : marqueur SOI FF D8, suivi d'un marqueur FF.
  if (magic(buf, 0, [0xff, 0xd8, 0xff])) return '.jpg';
  // PNG — RFC 2083 §3.1 : 89 50 4E 47 0D 0A 1A 0A.
  if (magic(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  // WEBP — conteneur RIFF, type de forme « WEBP » à l'offset 8.
  if (magic(buf, 0, [0x52, 0x49, 0x46, 0x46]) && magic(buf, 8, [0x57, 0x45, 0x42, 0x50])) return '.webp';
  return null;
};

/**
 * En-tête TGA — Truevision TGA File Format Specification 2.0.
 *
 * Le format n'a **aucune** signature en tête : sa marque (« TRUEVISION-XFILE. ») est un
 * pied de fichier, hors de portée d'une lecture d'en-tête. On valide donc la cohérence
 * des 18 octets du header, champ par champ, en plus de l'extension d'origine.
 */
const isTgaHeader = (buf: Buffer): boolean => {
  if (buf.length < 18) return false;
  const colorMapType = buf[1]!;
  const imageType = buf[2]!;
  const colorMapDepth = buf[7]!;
  const width = buf[12]! | (buf[13]! << 8);
  const height = buf[14]! | (buf[15]! << 8);
  const pixelDepth = buf[16]!;
  // Champ 2 : 0 = pas de palette, 1 = palette présente. Toute autre valeur est invalide.
  if (colorMapType > 1) return false;
  // Champ 3 : 0 (vide), 1/2/3 (non compressé), 9/10/11 (RLE).
  if (![0, 1, 2, 3, 9, 10, 11].includes(imageType)) return false;
  // Champ 4.3 : taille d'entrée de palette, nulle quand il n'y a pas de palette.
  if (colorMapType === 0 && colorMapDepth !== 0) return false;
  if (![1, 8, 15, 16, 24, 32].includes(pixelDepth)) return false;
  return width > 0 && height > 0;
};

/**
 * Le reste des formats image acceptés : EXR, DPX, TIFF, TGA (les livrables VFX), plus
 * BMP et GIF — que le navigateur affiche pourtant nativement, mais qui n'ont pas leur
 * place dans le jeu restreint de `detectImage` (contrôle des miniatures déposées).
 *
 * Aucun n'était reconnu jusqu'ici, alors que la table d'extensions de l'API v1 les
 * annonçait : un rendu de 4 Go montait intégralement dans MinIO avant d'être refusé à la
 * finalisation. La liste des formats à proxifier vit dans `lib/imageProxy`.
 */
export const detectProductionImage = (buf: Buffer, hintExt: string | null, size: number): string | null => {
  // OpenEXR — « OpenEXR File Layout » : nombre magique 20000630 (0x01312F76), écrit en
  // petit-boutien, soit 76 2F 31 01.
  if (magic(buf, 0, [0x76, 0x2f, 0x31, 0x01])) return '.exr';
  // DPX — SMPTE ST 268-1, champ « magic number » : « SDPX » (gros-boutien) ou « XPDS »
  // (petit-boutien, le même mot lu à l'envers).
  if (buf.length >= 4 && (ascii(buf, 0, 4) === 'SDPX' || ascii(buf, 0, 4) === 'XPDS')) return '.dpx';
  // TIFF — TIFF 6.0 §2 « Image File Header » : « II » (petit-boutien) ou « MM »
  // (gros-boutien) suivis du nombre 42. BigTIFF (version 43) est écarté : le décodeur
  // TIFF de FFmpeg ne le lit pas, l'accepter reviendrait à refaire la promesse non tenue.
  if (magic(buf, 0, [0x49, 0x49, 0x2a, 0x00]) || magic(buf, 0, [0x4d, 0x4d, 0x00, 0x2a])) return '.tif';
  // BMP — BITMAPFILEHEADER (Windows) : bfType = « BM ».
  if (magic(buf, 0, [0x42, 0x4d])) return '.bmp';
  // GIF — GIF89a §17 « Header » : « GIF » + version « 87a » ou « 89a ».
  if (buf.length >= 6 && (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a')) return '.gif';
  // TGA — pas de signature : extension d'origine + en-tête cohérent + fichier non vide.
  if (hintExt === '.tga' && size > 0 && isTgaHeader(buf)) return '.tga';
  return null;
};

/* ─────────────────────────────── 3D ─────────────────────────────── */

/**
 * 3D : GLB, FBX, USD(z/c/a), glTF.
 * `hintExt` (extension d'origine) et `size` sont nécessaires pour les formats sans magic bytes.
 */
export const detect3D = (buf: Buffer, hintExt: string | null, size: number): string | null => {
  if (buf.length >= 4) {
    // GLB : 'glTF'
    if (buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46) return '.glb';
    // FBX binaire : "Kaydara FBX Binary"
    if (buf.length >= 18 && ascii(buf, 0, 18) === 'Kaydara FBX Binary') return '.fbx';
    // Conteneur ZIP (PK..) : USDZ et les archives 3D génériques partagent ce magic.
    // On distingue via le hint d'extension (par défaut : USDZ).
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return hintExt === '.zip' ? '.zip' : '.usdz';
    }
    // USDC : 'PXR-USDC'
    if (buf.length >= 8 && ascii(buf, 0, 8) === 'PXR-USDC') return '.usdc';
    // USDA : '#usda'
    if (buf.length >= 5 && ascii(buf, 0, 5) === '#usda') return '.usda';
  }

  // glTF JSON : pas de magic bytes → hint + premier caractère non-blanc '{'
  if (hintExt === '.gltf') {
    let i = 0;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // BOM UTF-8
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
    if (buf[i] === 0x7b) return '.gltf';
  }

  // Formats 3D sans magic bytes fiable (texte/divers), validés par extension + taille.
  // Convertis ensuite en GLB côté worker (9.A1).
  const HINT_3D = ['.obj', '.dae', '.stl', '.usd'];
  if (hintExt && HINT_3D.includes(hintExt) && size > 0) return hintExt;

  return null;
};

/* ────────────────────────────── Splat ────────────────────────────── */

/**
 * Gaussian Splat : PLY (dont compressé), SPZ, SPLAT, KSPLAT, SOG/SOGS (viewer Spark/SparkJS).
 * Servis tels quels (aucune conversion serveur). La plupart n'ont pas de magic bytes fiable
 * → validés par extension + taille (comme les formats 3D texte).
 */
export const detectSplat = (buf: Buffer, hintExt: string | null, size: number): string | null => {
  // PLY (texte ou binaire, dont compressed-ply) : magic ASCII 'ply' + fin de ligne.
  if (
    buf.length >= 4 &&
    buf[0] === 0x70 &&
    buf[1] === 0x6c &&
    buf[2] === 0x79 &&
    (buf[3] === 0x0a || buf[3] === 0x0d)
  )
    return '.ply';
  // SPZ : conteneur gzip (1F 8B) encapsulant l'en-tête NGSP.
  if (hintExt === '.spz' && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return '.spz';
  // SPLAT : binaire brut, 32 octets par splat → taille multiple de 32.
  if (hintExt === '.splat' && size > 0 && size % 32 === 0) return '.splat';
  // KSPLAT / SOG / SOGS : conteneurs sans magic stable → hint d'extension + taille.
  const HINT_SPLAT = ['.ksplat', '.sog', '.sogs'];
  if (hintExt && HINT_SPLAT.includes(hintExt) && size > 0) return hintExt;
  return null;
};

/* ───────────────────── Extensions réellement admises ───────────────────── */

/**
 * Extensions qui passent la validation d'en-tête, par type de média.
 *
 * **Source de vérité unique** : la table d'extensions de l'API v1 (`PublishFlowService`)
 * et le sélecteur de fichiers en dérivent. Rien ne doit plus être annoncé ici sans que
 * `validateMediaHeader` sache le reconnaître — c'est exactement l'écart qui faisait
 * refuser un EXR ou un MXF *après* le transfert complet du fichier.
 *
 * `.abc` (Alembic) est délibérément absent : aucune signature n'est reconnue et aucun
 * convertisseur ne sait en produire un GLB. L'annoncer serait reproduire la promesse.
 */
export const SUPPORTED_EXTENSIONS: Record<MediaKind, readonly string[]> = {
  [MediaKind.VIDEO]: ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.mxf', '.ts', '.m2ts', '.mts'],
  [MediaKind.IMAGE]: [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.bmp',
    '.exr',
    '.dpx',
    '.tif',
    '.tiff',
    '.tga',
  ],
  [MediaKind.MODEL_3D]: [
    '.glb',
    '.gltf',
    '.fbx',
    '.obj',
    '.usd',
    '.usda',
    '.usdc',
    '.usdz',
    '.dae',
    '.stl',
    '.zip',
  ],
  [MediaKind.SPLAT]: ['.ply', '.splat', '.spz', '.ksplat', '.sog', '.sogs'],
};

/** L'extension est-elle admise pour ce type de média ? */
export const isSupportedExtension = (kind: MediaKind, ext: string): boolean =>
  SUPPORTED_EXTENSIONS[kind].includes(ext);

/** Type de média porté par une extension, ou `null` si aucun ne la revendique. */
export function inferKindFromExtension(ext: string): MediaKind | null {
  for (const kind of [MediaKind.VIDEO, MediaKind.IMAGE, MediaKind.MODEL_3D, MediaKind.SPLAT]) {
    if (isSupportedExtension(kind, ext)) return kind;
  }
  return null;
}

/**
 * Valide un buffer d'en-tête selon le type de média attendu.
 * Retourne l'extension canonique détectée, ou null si invalide.
 */
export const validateMediaHeader = (
  kind: MediaKind,
  buf: Buffer,
  hintExt: string | null,
  size: number,
): string | null => {
  switch (kind) {
    case MediaKind.VIDEO:
      return detectVideo(buf, hintExt);
    case MediaKind.IMAGE:
      return detectImage(buf) ?? detectProductionImage(buf, hintExt, size);
    case MediaKind.MODEL_3D:
      return detect3D(buf, hintExt, size);
    case MediaKind.SPLAT:
      return detectSplat(buf, hintExt, size);
    default:
      return null;
  }
};

export const getExtension = (filename: string): string => {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
};
