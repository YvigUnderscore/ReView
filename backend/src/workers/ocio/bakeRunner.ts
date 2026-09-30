// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { env } from '../../config/env';

/**
 * Voie **exacte** de cuisson d'une LUT d'affichage : OpenColorIO lui-même, appelé depuis le
 * worker via `workers/ocio/bake_lut.py`.
 *
 * Pourquoi Python et pas `ociobakelut` : l'image du worker ne contient **aucun** binaire OCIO
 * (`backend/Dockerfile` installe ffmpeg, assimp, Blender et un venv `usd-core` — rien d'autre).
 * Le venv `/opt/usdenv` existe déjà pour l'USD ; y ajouter la roue `opencolorio` (BSD-3-Clause)
 * suffit, et le script maîtrise alors la grille **et** l'écriture du `.cube` — là où la ligne de
 * commande de `ociobakelut` et le nom de ses formats varient d'une version d'OCIO à l'autre.
 *
 * Sans cette roue, `probePyOcio()` répond `false` et l'appelant se rabat sur `lib/ocioBake.ts`
 * (exact mais limité aux vues colorimétriques). Voir DOCUMENTATION/admin-guide/color-management.md.
 */

const execFileAsync = promisify(execFile);

/** Exécuteur injectable (tests). */
export type ExecRunner = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: ExecRunner = (file, args, opts) =>
  execFileAsync(file, args, { ...opts, windowsHide: true });

/** Marqueur du résumé imprimé par `bake_lut.py` — doit rester identique côté Python. */
export const OCIO_BAKE_MARKER = 'REVIEW_OCIO_JSON';

/** Délai maximal d'une cuisson (une grille 33³ prend moins d'une seconde). */
export const BAKE_TIMEOUT_MS = 120_000;

/**
 * Localise un script Python du worker. Les `.py` ne passent pas par `tsc` : ils restent dans
 * `src/workers/ocio/` (présent dans l'image via `COPY . .`) alors que le code tourne dans `dist/`.
 */
export function resolveOcioScript(name = 'bake_lut.py'): string {
  const packaged = join(__dirname, '..', '..', '..', 'src', 'workers', 'ocio', name);
  const candidates = [
    join(__dirname, name), // dist/workers/ocio (si copié un jour)
    packaged,
    join(process.cwd(), 'src', 'workers', 'ocio', name), // dev (tsx, cwd=backend)
  ];
  return candidates.find((p) => existsSync(p)) ?? packaged;
}

export interface PythonBakeOptions {
  configPath: string;
  display: string;
  view: string;
  inputSpace: string;
  size: number;
  outPath: string;
}

/** Ligne de commande du script de cuisson (pure — testée telle quelle). */
export function pythonBakeArgs(script: string, o: PythonBakeOptions): string[] {
  return [
    script,
    '--config',
    o.configPath,
    '--display',
    o.display,
    '--view',
    o.view,
    '--inputspace',
    o.inputSpace,
    '--size',
    String(o.size),
    '--out',
    o.outPath,
  ];
}

/** Résumé imprimé par le script (une ligne préfixée du marqueur, au milieu du bruit). */
export interface BakeSummary {
  display: string;
  view: string;
  size: number;
  ocio: string;
}

/** Lit le résumé JSON dans la sortie du script ; `null` si le marqueur est absent. */
export function parseBakeSummary(stdout: string): BakeSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(OCIO_BAKE_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(OCIO_BAKE_MARKER.length).trim()) as Partial<BakeSummary>;
    if (typeof parsed.display !== 'string' || typeof parsed.view !== 'string') return null;
    return {
      display: parsed.display,
      view: parsed.view,
      size: Number(parsed.size ?? 0),
      ocio: String(parsed.ocio ?? ''),
    };
  } catch {
    return null;
  }
}

let pyOcioProbe: Promise<boolean> | null = null;

/** Réinitialise la sonde d'outillage (tests, et changement d'image du worker). */
export function resetOcioProbe(): void {
  pyOcioProbe = null;
}

/** Vrai si le Python du worker sait importer PyOpenColorIO (sonde mise en cache). */
export function probePyOcio(runner: ExecRunner = defaultRunner): Promise<boolean> {
  pyOcioProbe ??= runner(env.USD_PYTHON_BIN, ['-c', 'import PyOpenColorIO'], { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  return pyOcioProbe;
}

/**
 * Cuit un couple display/view avec OCIO. Lève une erreur nommée si le script échoue —
 * l'appelant décide alors de se rabattre sur la cuisson intégrée.
 */
export async function bakeWithPython(
  o: PythonBakeOptions,
  runner: ExecRunner = defaultRunner,
): Promise<BakeSummary> {
  const script = resolveOcioScript();
  const { stdout } = await runner(env.USD_PYTHON_BIN, pythonBakeArgs(script, o), {
    timeout: BAKE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const summary = parseBakeSummary(stdout);
  if (!summary) throw new Error('bake_lut.py: no summary in output');
  if (summary.size !== o.size) throw new Error(`bake_lut.py: size ${summary.size} ≠ ${o.size}`);
  return summary;
}
