// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Measured quantity: the number of **static** import edges leading from the review page to
 * `hls.js`. It must be zero.
 *
 * Rollup splits chunks according to this graph: as long as a single module of the static closure
 * of `/review/:id` imported `hls.js`, the 510 kB of the adaptive player were downloaded and parsed
 * before displaying ANY review, image, 3D and splat included, although `VideoPane` is never mounted
 * there. A `import()` is enough to take it out; a static `import` accidentally reintroduced one day
 * (in a neighbouring hook, in a panel) would put it back without anything visible on screen. Hence
 * this test, which reads the graph of the sources rather than the build output: it runs in a
 * millisecond and does not require `vite build`.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const ENTRY = join(SRC, 'v2/pages/ReviewPage.tsx');
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', ''];

/** Strips block and line comments: a commented-out import is not an edge. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Specifiers imported **statically** by a file. `import type` is excluded (erased at build time,
 * so no effect on the chunk graph), and `import(...)` too: it is precisely the form being looked for.
 */
function staticImportsOf(code: string): string[] {
  const src = stripComments(code);
  const out: string[] = [];
  for (const m of src.matchAll(/\bimport\s+([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (!/^type\b/.test(m[1].trim())) out.push(m[2]);
  }
  for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?!type\b)(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g))
    out.push(m[1]);
  return out;
}

/** Disk file matching a relative specifier, or `null` if it has none. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = join(dirname(fromFile), spec);
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        /* directory: keep going */
      }
    }
  }
  return null;
}

/** Closure of static imports from `entry`: visited files and packages reached. */
function staticClosure(entry: string): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    for (const spec of staticImportsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const next = resolveRelative(file, spec);
        if (next) stack.push(next);
        continue;
      }
      // npm package: record who imports it, so that a failure names the culprit.
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      packages.set(pkg, [...(packages.get(pkg) ?? []), file.slice(SRC.length + 1).replace(/\\/g, '/')]);
    }
  }
  return { files, packages };
}

describe('import graph of /review/:id', () => {
  const { files, packages } = staticClosure(ENTRY);

  it('does reach the video player (otherwise the test would prove nothing)', () => {
    const reached = [...files].map((f) => f.replace(/\\/g, '/'));
    expect(reached.some((f) => f.endsWith('/review/VideoPane.tsx'))).toBe(true);
    expect(reached.some((f) => f.endsWith('/review/useHlsPlayer.ts'))).toBe(true);
    // Sanity: a package genuinely needed for the first screen is indeed seen by the walker.
    expect(packages.has('react')).toBe(true);
  });

  it('does not reach hls.js through ANY static import', () => {
    expect(packages.get('hls.js') ?? []).toEqual([]);
  });

  it('does load it on demand: adaptive playback has not disappeared', () => {
    const runtime = readFileSync(join(SRC, 'v2/pages/review/hlsRuntime.ts'), 'utf8');
    // `.then`: the VALUE form of `import()`, not the `typeof import('hls.js')` of the types.
    expect(stripComments(runtime)).toMatch(/import\(\s*['"]hls\.js['"]\s*\)\s*\.then/);
  });
});
