// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { env } from '../../config/env';

/**
 * **Exact** path for baking a display LUT: OpenColorIO itself, called from the
 * worker via `workers/ocio/bake_lut.py`.
 *
 * Why Python rather than `ociobakelut`: the worker image contains **no** OCIO binary
 * (`backend/Dockerfile` installs ffmpeg, assimp, Blender and a `usd-core` venv, nothing else).
 * The `/opt/usdenv` venv already exists for USD; adding the `opencolorio` wheel (BSD-3-Clause)
 * is enough, and the script then controls both the grid **and** the `.cube` writing, whereas the command
 * line of `ociobakelut` and its format names vary from one OCIO version to another.
 *
 * Without this wheel, `probePyOcio()` returns `false` and the caller falls back to `lib/ocioBake.ts`
 * (exact, but limited to colorimetric views). See DOCUMENTATION/admin-guide/color-management.md.
 */

const execFileAsync = promisify(execFile);

/** Injectable executor (tests). */
export type ExecRunner = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: ExecRunner = (file, args, opts) =>
  execFileAsync(file, args, { ...opts, windowsHide: true });

/** Summary marker printed by `bake_lut.py`; must stay identical on the Python side. */
export const OCIO_BAKE_MARKER = 'REVIEW_OCIO_JSON';

/** Maximum duration of a bake (a 33³ grid takes under a second). */
export const BAKE_TIMEOUT_MS = 120_000;

/**
 * Locates a worker Python script. The `.py` files do not go through `tsc`: they stay in
 * `src/workers/ocio/` (present in the image via `COPY . .`) while the code runs from `dist/`.
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

/** Command line of the bake script (pure, tested as is). */
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

/** Summary printed by the script (one line prefixed with the marker, amid the noise). */
export interface BakeSummary {
  display: string;
  view: string;
  size: number;
  ocio: string;
}

/** Reads the JSON summary from the script's output; `null` if the marker is absent. */
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

/** Resets the tooling probe (tests, and worker image change). */
export function resetOcioProbe(): void {
  pyOcioProbe = null;
}

/** True if the worker's Python can import PyOpenColorIO (probe cached). */
export function probePyOcio(runner: ExecRunner = defaultRunner): Promise<boolean> {
  pyOcioProbe ??= runner(env.USD_PYTHON_BIN, ['-c', 'import PyOpenColorIO'], { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  return pyOcioProbe;
}

/**
 * Bakes a display/view pair with OCIO. Throws a named error if the script fails;
 * the caller then decides whether to fall back to built-in baking.
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
