// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storage } from '../../services/StorageService';
import { logger } from '../../lib/logger';
import {
  bakeBuiltinLut,
  BUILTIN_SOURCE,
  LUT_SIZE,
  lutStorageKey,
  serializeCube,
  SRGB_TEXTURE_NAME,
} from '../../lib/ocioBake';
import { getConfigDisplays, getEntry } from '../../services/OcioService';
import { bakeWithPython, probePyOcio } from './bakeRunner';

/**
 * Baking of the display LUTs of an OCIO config, stored **next to** the `.ocio` in MinIO
 * (`studio/ocio/luts/<configId>/`). Triggered when a config is installed and replayable
 * from the admin; the viewer only reads them.
 *
 * Order of paths, most faithful first: OpenColorIO via `bake_lut.py`, then the built-in
 * colorimetric fallback. A pair neither can bake **is not** approximated:
 * it is counted in `skipped` and the viewer shows "transform unavailable".
 */

/** Cap on pairs baked in one pass (an ACES config exposes ~40). */
export const MAX_COUPLES = 64;

export interface BakeRequest {
  configId: string;
  /** Specific pair to bake; otherwise all pairs of the config. */
  display?: string;
  view?: string;
  /** Re-bake even if the object already exists (tooling change). */
  force?: boolean;
}

export interface BakeReport {
  configId: string;
  baked: number;
  reused: number;
  skipped: { display: string; view: string }[];
  method: 'ocio' | 'builtin' | 'mixed' | 'none';
}

/** True if the object already exists in MinIO. */
async function exists(key: string): Promise<boolean> {
  try {
    await storage.statObject(key);
    return true;
  } catch {
    return false;
  }
}

/** display/view pairs to bake for a request. */
export function couplesFor(
  displays: { name: string; views: string[] }[],
  req: Pick<BakeRequest, 'display' | 'view'>,
): { display: string; view: string }[] {
  if (req.display && req.view) return [{ display: req.display, view: req.view }];
  const out: { display: string; view: string }[] = [];
  for (const d of displays)
    for (const v of d.views) {
      if (out.length >= MAX_COUPLES) return out;
      out.push({ display: d.name, view: v });
    }
  return out;
}

/** Built-in baking of a pair into `.cube` text, or `null` if the view is out of range. */
export function builtinCube(display: string, view: string): string | null {
  const lut = bakeBuiltinLut(display, view);
  return lut ? serializeCube(lut, `${display} / ${view}`, BUILTIN_SOURCE) : null;
}

/** Writes a `.cube` into MinIO (raw text: the viewer reads it via `fetch`). */
async function put(key: string, text: string): Promise<void> {
  await storage.putObject(key, Buffer.from(text, 'utf-8'), 'text/plain; charset=utf-8');
}

/**
 * Bakes the requested LUTs. The `.ocio` is only downloaded if the OpenColorIO path is
 * available: the built-in fallback does not need it.
 */
export async function runBake(req: BakeRequest): Promise<BakeReport> {
  const entry = await getEntry(req.configId);
  if (!entry) return { configId: req.configId, baked: 0, reused: 0, skipped: [], method: 'none' };

  const displays = await getConfigDisplays(req.configId);
  const couples = couplesFor(displays, req);
  const withOcio = await probePyOcio();

  let dir: string | null = null;
  let configPath = '';
  if (withOcio) {
    dir = await mkdtemp(join(tmpdir(), 'review-ocio-'));
    configPath = join(dir, 'config.ocio');
    await storage.downloadToFile(entry.storageKey, configPath);
  }

  const report: BakeReport = { configId: req.configId, baked: 0, reused: 0, skipped: [], method: 'none' };
  const used = new Set<'ocio' | 'builtin'>();
  try {
    for (const c of couples) {
      const key = lutStorageKey(req.configId, c.display, c.view);
      if (!req.force && (await exists(key))) {
        report.reused++;
        continue;
      }
      let text: string | null = null;
      if (withOcio && dir) {
        const outPath = join(dir, 'out.cube');
        try {
          await bakeWithPython({
            configPath,
            display: c.display,
            view: c.view,
            inputSpace: SRGB_TEXTURE_NAME,
            size: LUT_SIZE,
            outPath,
          });
          text = await readFile(outPath, 'utf-8');
          used.add('ocio');
        } catch (err) {
          logger.warn({ err, ...c }, 'ocio bake: OpenColorIO failed, falling back');
        }
      }
      if (!text) {
        text = builtinCube(c.display, c.view);
        if (text) used.add('builtin');
      }
      if (!text) {
        report.skipped.push(c);
        continue;
      }
      await put(key, text);
      report.baked++;
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  report.method =
    used.size === 2 ? 'mixed' : used.has('ocio') ? 'ocio' : used.has('builtin') ? 'builtin' : 'none';
  logger.info({ ...report, skipped: report.skipped.length }, 'ocio bake done');
  return report;
}
