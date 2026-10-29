// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real MIME validation by magic bytes (ported from utils/validation.js in v1).
 *
 * In v2 the files live in MinIO: we validate from a header buffer (the first ~32 bytes read from the stored
 * object), not from the local filesystem.
 *
 * **Structuring constraint**: `MediaService.finalize` only reads 32 bytes. Any signature added here must
 * therefore fit in that window — this is what excludes the TGA file footer ("TRUEVISION-XFILE.", at the end
 * of the object) and forces this format to be validated through the consistency of its 18-byte header.
 *
 * Bytes are never guessed: each signature carries the reference of the specification it comes from.
 */

import { MediaKind } from '@prisma/client';

const ascii = (buf: Buffer, start: number, end: number): string => buf.toString('utf8', start, end);

/** Compares a byte sequence at the given offset. */
const magic = (buf: Buffer, offset: number, bytes: number[]): boolean => {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
};

/* Video */

/**
 * Video containers with a stable signature: Matroska/WebM, ISOBMFF (MP4/MOV/M4V), AVI (RIFF) and MXF
 * (SMPTE ST 377-1).
 */
const detectVideoContainer = (buf: Buffer): string | null => {
  // WEBM/MKV — EBML, RFC 8794 §4.1: 1A 45 DF A3.
  if (magic(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return '.webm';
  // AVI — RIFF (Microsoft Multimedia): "RIFF" at 0, form type "AVI" at 8.
  // Checked BEFORE ISOBMFF: the two families do not overlap, but the order keeps the code independent of the
  // order of the `if`s.
  if (magic(buf, 0, [0x52, 0x49, 0x46, 0x46]) && magic(buf, 8, [0x41, 0x56, 0x49, 0x20])) return '.avi';
  // MXF — SMPTE ST 377-1: the file opens on the Header Partition Pack, whose universal key starts with
  // 06 0E 2B 34 02 05 01 01 0D 01 02 (11 stable bytes, whatever the partition type). Accepted limitation: a
  // file preceded by a "run-in" sequence (allowed up to 64 KB by the standard, never written by cameras and
  // editing stations) is not recognised within a 32-byte window.
  if (magic(buf, 0, [0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02])) return '.mxf';
  // MP4/MOV/M4V — ISO/IEC 14496-12: "ftyp" box at offset 4.
  if (magic(buf, 4, [0x66, 0x74, 0x79, 0x70])) {
    // QuickTime "qt  " major brand → .mov (the container of ProRes masters).
    if (magic(buf, 8, [0x71, 0x74, 0x20, 0x20])) return '.mov';
    return '.mp4';
  }
  return null;
};

/**
 * MPEG-TS — ISO/IEC 13818-1: a sequence of 188-byte packets opened by the sync byte 0x47; the M2TS/BDAV
 * variant prefixes each packet with a 4-byte timecode, so the sync byte falls at offset 4.
 *
 * A single byte is not a signature: we therefore ALSO require the original extension and a zero
 * `transport_error_indicator` (high bit of the byte after the sync), as the standard requires for an
 * uncorrupted packet. The full check (sync found every 188 bytes) would require reading the file, not its header.
 */
const detectTransportStream = (buf: Buffer, hintExt: string | null): string | null => {
  const at = (offset: number): boolean =>
    buf.length > offset + 1 && buf[offset] === 0x47 && (buf[offset + 1]! & 0x80) === 0;
  if (hintExt === '.ts' && at(0)) return '.ts';
  if ((hintExt === '.m2ts' || hintExt === '.mts') && at(4)) return hintExt;
  return null;
};

/** Video: MP4, MOV, M4V, WEBM/MKV, AVI, MXF, MPEG-TS. Canonical extension or null. */
export const detectVideo = (buf: Buffer, hintExt: string | null = null): string | null => {
  if (buf.length < 12) return null;
  return detectVideoContainer(buf) ?? detectTransportStream(buf, hintExt);
};

/* Image */

/**
 * Image displayable as-is by a browser: JPG, PNG, WEBP.
 *
 * Deliberately restricted: this is the function `MediaService` uses to check a thumbnail uploaded as a data URL,
 * where only these three types are accepted. Production formats go through `detectProductionImage`.
 */
export const detectImage = (buf: Buffer): string | null => {
  if (buf.length < 12) return null;
  // JPEG — ITU-T T.81: SOI marker FF D8, followed by a marker FF.
  if (magic(buf, 0, [0xff, 0xd8, 0xff])) return '.jpg';
  // PNG — RFC 2083 §3.1: 89 50 4E 47 0D 0A 1A 0A.
  if (magic(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  // WEBP — RIFF container, form type "WEBP" at offset 8.
  if (magic(buf, 0, [0x52, 0x49, 0x46, 0x46]) && magic(buf, 8, [0x57, 0x45, 0x42, 0x50])) return '.webp';
  return null;
};

/**
 * TGA header — Truevision TGA File Format Specification 2.0.
 *
 * The format has **no** leading signature: its mark ("TRUEVISION-XFILE.") is a file footer, out of reach of a
 * header read. We therefore validate the consistency of the 18 header bytes, field by field, in addition to the
 * original extension.
 */
const isTgaHeader = (buf: Buffer): boolean => {
  if (buf.length < 18) return false;
  const colorMapType = buf[1]!;
  const imageType = buf[2]!;
  const colorMapDepth = buf[7]!;
  const width = buf[12]! | (buf[13]! << 8);
  const height = buf[14]! | (buf[15]! << 8);
  const pixelDepth = buf[16]!;
  // Field 2: 0 = no palette, 1 = palette present. Any other value is invalid.
  if (colorMapType > 1) return false;
  // Field 3: 0 (empty), 1/2/3 (uncompressed), 9/10/11 (RLE).
  if (![0, 1, 2, 3, 9, 10, 11].includes(imageType)) return false;
  // Field 4.3: palette entry size, zero when there is no palette.
  if (colorMapType === 0 && colorMapDepth !== 0) return false;
  if (![1, 8, 15, 16, 24, 32].includes(pixelDepth)) return false;
  return width > 0 && height > 0;
};

/**
 * The remaining accepted image formats: EXR, DPX, TIFF, TGA (VFX deliverables), plus BMP and GIF — which
 * browsers do display natively, but which have no place in the restricted set of `detectImage` (checking of
 * uploaded thumbnails).
 *
 * None was recognised until now, although the v1 API's extension table announced them: a 4 GB render was
 * uploaded in full into MinIO before being refused at finalisation. The list of formats to proxy lives in
 * `lib/imageProxy`.
 */
export const detectProductionImage = (buf: Buffer, hintExt: string | null, size: number): string | null => {
  // OpenEXR — "OpenEXR File Layout": magic number 20000630 (0x01312F76), written little-endian, i.e. 76 2F 31 01.
  if (magic(buf, 0, [0x76, 0x2f, 0x31, 0x01])) return '.exr';
  // DPX — SMPTE ST 268-1, "magic number" field: "SDPX" (big-endian) or "XPDS" (little-endian, the same word read backwards).
  if (buf.length >= 4 && (ascii(buf, 0, 4) === 'SDPX' || ascii(buf, 0, 4) === 'XPDS')) return '.dpx';
  // TIFF — TIFF 6.0 §2 "Image File Header": "II" (little-endian) or "MM" (big-endian) followed by the number 42.
  // BigTIFF (version 43) is set aside: FFmpeg's TIFF decoder does not read it, accepting it would repeat the broken promise.
  if (magic(buf, 0, [0x49, 0x49, 0x2a, 0x00]) || magic(buf, 0, [0x4d, 0x4d, 0x00, 0x2a])) return '.tif';
  // BMP — BITMAPFILEHEADER (Windows): bfType = "BM".
  if (magic(buf, 0, [0x42, 0x4d])) return '.bmp';
  // GIF — GIF89a §17 "Header": "GIF" + version "87a" or "89a".
  if (buf.length >= 6 && (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a')) return '.gif';
  // TGA — no signature: original extension + consistent header + non-empty file.
  if (hintExt === '.tga' && size > 0 && isTgaHeader(buf)) return '.tga';
  return null;
};

/* 3D */

/**
 * 3D: GLB, FBX, USD(z/c/a), glTF.
 * `hintExt` (original extension) and `size` are needed for formats without magic bytes.
 */
export const detect3D = (buf: Buffer, hintExt: string | null, size: number): string | null => {
  if (buf.length >= 4) {
    // GLB : 'glTF'
    if (buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46) return '.glb';
    // Binary FBX: "Kaydara FBX Binary"
    if (buf.length >= 18 && ascii(buf, 0, 18) === 'Kaydara FBX Binary') return '.fbx';
    // ZIP container (PK..): USDZ and generic 3D archives share this magic.
    // Told apart by the extension hint (default: USDZ).
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return hintExt === '.zip' ? '.zip' : '.usdz';
    }
    // USDC : 'PXR-USDC'
    if (buf.length >= 8 && ascii(buf, 0, 8) === 'PXR-USDC') return '.usdc';
    // USDA : '#usda'
    if (buf.length >= 5 && ascii(buf, 0, 5) === '#usda') return '.usda';
  }

  // glTF JSON: no magic bytes → hint + first non-blank character '{'
  if (hintExt === '.gltf') {
    let i = 0;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // BOM UTF-8
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
    if (buf[i] === 0x7b) return '.gltf';
  }

  // 3D formats without a reliable magic (text/misc), validated by extension + size.
  // Converted to GLB by the worker afterwards (9.A1).
  const HINT_3D = ['.obj', '.dae', '.stl', '.usd'];
  if (hintExt && HINT_3D.includes(hintExt) && size > 0) return hintExt;

  return null;
};

/* Splat */

/**
 * Gaussian Splat: PLY (including compressed), SPZ, SPLAT, KSPLAT, SOG/SOGS (Spark/SparkJS viewer).
 * Served as-is (no server-side conversion). Most have no reliable magic bytes → validated by extension + size
 * (like the text 3D formats).
 */
export const detectSplat = (buf: Buffer, hintExt: string | null, size: number): string | null => {
    // PLY (text or binary, including compressed-ply): ASCII magic 'ply' + line break.
  if (
    buf.length >= 4 &&
    buf[0] === 0x70 &&
    buf[1] === 0x6c &&
    buf[2] === 0x79 &&
    (buf[3] === 0x0a || buf[3] === 0x0d)
  )
    return '.ply';
    // SPZ: gzip container (1F 8B) wrapping the NGSP header.
  if (hintExt === '.spz' && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return '.spz';
    // SPLAT: raw binary, 32 bytes per splat → size multiple of 32.
  if (hintExt === '.splat' && size > 0 && size % 32 === 0) return '.splat';
    // KSPLAT / SOG / SOGS: containers without a stable magic → extension hint + size.
  const HINT_SPLAT = ['.ksplat', '.sog', '.sogs'];
  if (hintExt && HINT_SPLAT.includes(hintExt) && size > 0) return hintExt;
  return null;
};

/* Extensions accepted in practice */

/**
 * Extensions that pass header validation, per media type.
 *
 * **Single source of truth**: the extension table of the v1 API (`PublishFlowService`) and the file picker derive
 * from it. Nothing may be announced here any more without `validateMediaHeader` knowing how to recognise it —
 * this is exactly the gap that made an EXR or an MXF be refused *after* the full transfer of the file.
 *
 * `.abc` (Alembic) is deliberately absent: no signature is recognised and no converter can produce a GLB from it.
 * Announcing it would repeat the promise.
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

/** Is the extension accepted for this media type? */
export const isSupportedExtension = (kind: MediaKind, ext: string): boolean =>
  SUPPORTED_EXTENSIONS[kind].includes(ext);

/** Media type carried by an extension, or `null` if none claims it. */
export function inferKindFromExtension(ext: string): MediaKind | null {
  for (const kind of [MediaKind.VIDEO, MediaKind.IMAGE, MediaKind.MODEL_3D, MediaKind.SPLAT]) {
    if (isSupportedExtension(kind, ext)) return kind;
  }
  return null;
}

/**
 * Validates a header buffer against the expected media type.
 * Returns the canonical extension detected, or null if invalid.
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
