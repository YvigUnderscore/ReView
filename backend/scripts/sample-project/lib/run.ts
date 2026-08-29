// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Exécution des outils externes du générateur : Blender (import glTF, export USD, rendu de
 * splats) et le Python d'OpenUSD (assemblage du graphe).
 *
 * Chaque script imprime **une** ligne marquée en JSON ; le reste de la sortie est du bruit
 * (Blender en écrit beaucoup). On lit donc la ligne marquée plutôt que la dernière ligne,
 * exactement comme le fait le worker de conversion.
 */

/** Emplacements usuels de Blender, du plus récent au plus ancien. */
const BLENDER_CANDIDATES = [
  process.env.SAMPLE_BLENDER_BIN,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  '/usr/bin/blender',
  '/opt/blender/blender',
].filter((p): p is string => Boolean(p));

let blenderBin: string | null = null;

export function findBlender(): string {
  if (blenderBin) return blenderBin;
  const found = BLENDER_CANDIDATES.find((p) => existsSync(p));
  if (!found)
    throw new Error(
      'Blender not found — set SAMPLE_BLENDER_BIN to the executable (needed for USD and splat generation)',
    );
  blenderBin = found;
  return found;
}

/** Dossier des scripts Python du générateur. */
export const PY_DIR = resolve(__dirname, '..', 'py');

/** Extrait la ligne `MARQUEUR {json}` d'une sortie bavarde. */
function readMarker<T>(stdout: string, marker: string): T {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(marker));
  if (!line) throw new Error(`marker ${marker} not found in output:\n${stdout.slice(-1500)}`);
  return JSON.parse(line.slice(marker.length).trim()) as T;
}

/** Lance un script Blender headless et lit sa ligne de résumé. */
export async function runBlender<T>(script: string, args: string[], marker: string): Promise<T> {
  const { stdout } = await execFileAsync(
    findBlender(),
    ['-b', '--factory-startup', '--python-exit-code', '1', '--python', join(PY_DIR, script), '--', ...args],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 15 * 60 * 1000 },
  );
  return readMarker<T>(stdout, marker);
}

/** Lance un script Python (OpenUSD via `usd-core`) et lit sa ligne de résumé. */
export async function runPython<T>(script: string, args: string[], marker: string): Promise<T> {
  const bin = process.env.SAMPLE_PYTHON_BIN ?? 'python';
  const { stdout } = await execFileAsync(bin, [join(PY_DIR, script), ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    timeout: 5 * 60 * 1000,
  });
  return readMarker<T>(stdout, marker);
}
