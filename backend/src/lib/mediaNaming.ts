// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getExtension } from './fileSignatures';

/**
 * Name of a media imported from ShotGrid.
 *
 * The media carried the name of the **attached file** (`playblast_final_v2_RETAKE.mov`), whereas the version carried
 * the `code` of the ShotGrid Version. The review screen displaying the media name, ReView and the site named the same
 * thing differently — impossible to find a shot from one window to the other, and impossible to mention it aloud
 * during dailies.
 *
 * We take the site's code, keeping the file's **real extension**: it is not decorative. `finalize` uses it to validate
 * the header bytes, `reprocess` to choose the job to run, and the FFmpeg worker to name its outputs.
 */

/** Extensions deduced from a content type, when the attached file carries none. */
const MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tif',
  'image/webp': '.webp',
  'image/x-exr': '.exr',
  'application/pdf': '.pdf',
};

/** The extension to keep: that of the delivered file, otherwise that of the declared type. */
export function extensionFor(filename: string, mimeType?: string | null): string {
  const fromName = getExtension(filename);
  if (fromName) return fromName;
  const type = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_EXTENSIONS[type] ?? '';
}

/**
 * Sanitises a code coming from the site before making a file name of it.
 *
 * The storage key is a path (`projects/{slug}/{parent}/{version}/{id}/{name}`): a code containing `/`, `\` or `..`
 * would make one segment too many. Sites let just about anything through in a `code`.
 */
export function safeCode(code: string): string {
  return (
    [...code]
      // Control characters: rare in a code, but they break everything downstream.
      // Filtered one by one rather than by an escape class, which ESLint refuses.
      .filter((c) => c >= ' ')
      .join('')
      .replace(/[/\\]+/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim()
  );
}

/**
 * The media name: `<ShotGrid code><file extension>`.
 *
 * Many sites already name the Version after the file (`SH010_comp_v003.mov`): blindly concatenating would give
 * `SH010_comp_v003.mov.mov`.
 *
 * Without a usable code, the file name is kept — better the original name than an empty one.
 */
export function sgMediaName(input: {
  code: string | null | undefined;
  sourceFilename: string;
  mimeType?: string | null;
}): string {
  const code = safeCode(input.code ?? '');
  if (!code) return input.sourceFilename;
  const extension = extensionFor(input.sourceFilename, input.mimeType);
  if (!extension) return code;
  return code.toLowerCase().endsWith(extension) ? code : `${code}${extension}`;
}
