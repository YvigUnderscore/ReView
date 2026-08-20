// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getExtension } from './fileSignatures';

/**
 * Nom d'un média importé depuis ShotGrid.
 *
 * Le média portait le nom du **fichier joint** (`playblast_final_v2_RETAKE.mov`), alors
 * que la version portait le `code` de la Version ShotGrid. L'écran de review affichant le
 * nom du média, ReView et le site nommaient donc la même chose différemment — impossible
 * de retrouver un plan d'une fenêtre à l'autre, et impossible d'en parler à voix haute
 * pendant des dailies.
 *
 * On reprend le code du site, en gardant l'**extension réelle** du fichier : elle n'est
 * pas décorative. `finalize` s'en sert pour valider les octets d'en-tête, `reprocess`
 * pour choisir le travail à lancer, et le worker FFmpeg pour nommer ses sorties.
 */

/** Extensions déduites d'un content-type, quand le fichier joint n'en porte pas. */
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

/** L'extension à conserver : celle du fichier livré, sinon celle du type déclaré. */
export function extensionFor(filename: string, mimeType?: string | null): string {
  const fromName = getExtension(filename);
  if (fromName) return fromName;
  const type = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_EXTENSIONS[type] ?? '';
}

/**
 * Assainit un code venu du site avant d'en faire un nom de fichier.
 *
 * La clé de stockage est un chemin (`projects/{slug}/{parent}/{version}/{id}/{nom}`) :
 * un code contenant `/`, `\` ou `..` y fabriquerait un segment de plus. Les sites laissent
 * passer à peu près n'importe quoi dans un `code`.
 */
export function safeCode(code: string): string {
  return (
    [...code]
      // Caractères de contrôle : rares dans un code, mais ils cassent tout en aval.
      // Filtrés un par un plutôt que par une classe d'échappement, qu'ESLint refuse.
      .filter((c) => c >= ' ')
      .join('')
      .replace(/[/\\]+/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim()
  );
}

/**
 * Le nom du média : `<code ShotGrid><extension du fichier>`.
 *
 * Beaucoup de sites nomment déjà la Version d'après le fichier (`SH010_comp_v003.mov`) :
 * concaténer aveuglément donnerait `SH010_comp_v003.mov.mov`.
 *
 * Sans code exploitable, on garde le nom du fichier — mieux vaut le nom d'origine qu'un
 * nom vide.
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
