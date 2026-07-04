/**
 * Validation MIME réelle par magic bytes (porté de utils/validation.js v1).
 *
 * En v2 les fichiers vivent dans MinIO : on valide à partir d'un buffer d'en-tête
 * (les ~32 premiers octets lus depuis l'objet stocké), pas depuis le filesystem local.
 */

import { MediaKind } from '@prisma/client';

const ascii = (buf: Buffer, start: number, end: number): string => buf.toString('utf8', start, end);

/** Vidéo : MP4, MOV, WEBM. Retourne l'extension canonique ou null. */
export const detectVideo = (buf: Buffer): string | null => {
  if (buf.length < 12) return null;
  // WEBM : 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return '.webm';
  // MP4/MOV : 'ftyp' à l'offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    // QuickTime 'qt  ' en major brand → .mov
    if (buf[8] === 0x71 && buf[9] === 0x74 && buf[10] === 0x20 && buf[11] === 0x20) return '.mov';
    return '.mp4';
  }
  return null;
};

/** Image : JPG, PNG, WEBP. */
export const detectImage = (buf: Buffer): string | null => {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return '.png';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return '.webp';
  return null;
};

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
      return detectVideo(buf);
    case MediaKind.IMAGE:
      return detectImage(buf);
    case MediaKind.MODEL_3D:
      return detect3D(buf, hintExt, size);
    default:
      return null;
  }
};

export const getExtension = (filename: string): string => {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
};
