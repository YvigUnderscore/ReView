// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export d'un montage en un fichier unique (Phase 45) — helpers PURS, testés.
 *
 * Concaténer des rushes hétérogènes suppose de les ramener d'abord à un format commun :
 * même résolution, même cadence, même piste audio. Sans cette normalisation, `concat`
 * produit un fichier qui se désynchronise ou refuse de s'ouvrir dès que deux plans n'ont
 * pas exactement le même profil — cas normal en production, où un playblast Maya et un
 * rendu Nuke ne sortent jamais pareils.
 */

/** Profil commun de l'export : ce que tous les segments doivent devenir avant concaténation. */
export interface ExportProfile {
  width: number;
  height: number;
  fps: number;
}

/** Clé de stockage du master d'un montage — déterministe : un montage, un master. */
export function masterKey(timelineId: number): string {
  return `derived/timeline/${timelineId}/master.mp4`;
}

/**
 * Échappe un texte pour le filtre `drawtext` de ffmpeg. Les codes de plan contiennent des
 * caractères que le parseur de filtres interprète (`:` sépare les options, `'` délimite),
 * et un code mal échappé fait échouer tout l'export.
 */
export function escapeDrawText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

/**
 * Ligne d'un fichier de liste `concat`. Le chemin est cité et les apostrophes échappées
 * selon la syntaxe attendue par le demuxer, qui n'est pas celle du shell.
 */
export function concatEntry(path: string): string {
  return `file '${path.replace(/'/g, "'\\''")}'`;
}

/** Fichier de liste complet pour `ffmpeg -f concat`. */
export function concatList(paths: readonly string[]): string {
  return paths.map(concatEntry).join('\n') + '\n';
}

/** Arguments de normalisation d'un segment vers le profil commun. */
export function normalizeArgs(profile: ExportProfile): string[] {
  const { width, height, fps } = profile;
  return [
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},setsar=1`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    // Piste audio imposée : un segment muet suivi d'un segment sonore casse la
    // concaténation si les flux ne se correspondent pas un à un.
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
  ];
}

/** Sources synthétiques d'un carton : une image noire et un silence de même durée. */
export interface PlaceholderInputs {
  video: string;
  audio: string;
}

/** Entrées d'un carton : fond noir silencieux, à la durée du plan manquant. */
export function placeholderInputs(profile: ExportProfile, duration: number): PlaceholderInputs {
  const safe = Math.max(0.5, Math.round(duration * 1000) / 1000);
  return {
    video: `color=c=black:s=${profile.width}x${profile.height}:r=${profile.fps}:d=${safe}`,
    audio: `anullsrc=channel_layout=stereo:sample_rate=48000:d=${safe}`,
  };
}

/** Texte incrusté sur un carton : le code du plan, et pourquoi il est vide. */
export function placeholderFilter(profile: ExportProfile, shotCode: string, label: string): string {
  const size = Math.max(16, Math.round(profile.height / 18));
  const text = escapeDrawText(`${shotCode} — ${label}`);
  return `drawtext=text='${text}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2`;
}
