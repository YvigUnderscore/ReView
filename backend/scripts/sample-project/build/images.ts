// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';
import { OUT_DIR, WORK_DIR } from '../config';
import { ensureDir, exists, ffmpeg } from '../lib/download';

/**
 * Images fabriquées de toutes pièces : avatars et pastilles de département.
 *
 * Rien n'est emprunté à personne — un avatar de démonstration ne doit ressembler au visage
 * de qui que ce soit. Deux couleurs, des initiales, et la même géométrie pour tout le monde.
 */

const FONT_FILE = 'burnin-font.ttf';

/** Avatar carré : dégradé radial aux couleurs du membre, initiales centrées. */
export async function makeAvatar(
  initials: string,
  colors: [string, string],
  out: string,
  size = 512,
): Promise<string> {
  const target = join(OUT_DIR, out);
  if (await exists(target)) return target;
  await ensureDir(join(target, '..'));
  const [inner, outer] = colors.map((c) => `0x${c.replace('#', '')}`);
  await ffmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `gradients=s=${size}x${size}:c0=${inner}:c1=${outer}:type=radial:n=2:d=1`,
      '-frames:v',
      '1',
      '-vf',
      `drawtext=fontfile=${FONT_FILE}:text='${initials}':fontcolor=white@0.94:fontsize=${Math.round(size * 0.38)}:x=(w-tw)/2:y=(h-th)/2-${Math.round(size * 0.03)}`,
      target,
    ],
    WORK_DIR,
  );
  return target;
}

/** Pastille de département : aplat teinté et clé courte, lisible dans une grille dense. */
export async function makeDepartmentBadge(code: string, color: string, out: string): Promise<string> {
  const target = join(OUT_DIR, out);
  if (await exists(target)) return target;
  await ensureDir(join(target, '..'));
  const hex = `0x${color.replace('#', '')}`;
  await ffmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `gradients=s=256x256:c0=${hex}:c1=0x101318:type=linear:n=2:d=1`,
      '-frames:v',
      '1',
      '-vf',
      `drawtext=fontfile=${FONT_FILE}:text='${code}':fontcolor=white@0.92:fontsize=54:x=(w-tw)/2:y=(h-th)/2`,
      target,
    ],
    WORK_DIR,
  );
  return target;
}
