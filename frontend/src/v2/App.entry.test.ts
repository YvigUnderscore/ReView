// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * What is in the **first load**, measured on the static import graph.
 *
 * The byte budget (`scripts/check-bundle-budget.mjs`) says that we went over; it never
 * says *what*. Yet a single line is enough to bring a whole library into the
 * entry file: an `import { motion } from 'framer-motion'` added to a component of
 * the shell, or a tab re-imported statically "to go faster". The harm is done
 * in the next commit, on an unrelated change, and nobody makes the link.
 *
 * This test walks exactly what the browser downloads before running anything:
 * `main.jsx` and the closure of its **static** imports. The dynamic `import()`s are
 * separate chunks and so end the walk. Each prohibition
 * carries the gzip weight it cost, measured on a real build.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(SRC, 'main.jsx');

/** Extensions tried in order, the way Vite's resolver does. */
const CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'];

/** Files we do not walk: they have no imports to follow. */
const LEAF = /\.(css|json|svg|png|jpg|woff2?)$/;

function resolveSpec(fromFile: string, spec: string): string | null {
  const clean = spec.split('?')[0];
  const base = path.resolve(path.dirname(fromFile), clean);
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Specifiers imported **statically** by a file.
 *
 * The three forms that produce code at load time: `import … from`, `import 'x'`
 * (side effect) and `export … from` (re-export). `import type` is set aside: TypeScript
 * erases it, and `import('x')`, which is never at the start of a line followed by a space, cannot
 * be confused with the previous ones.
 */
function staticSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?!type\s)[^;'"]*?\s*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?!type\s)(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

interface EntryGraph {
  /** Files of the repo, as paths relative to `src/`, with `/` separators. */
  files: Set<string>;
  /** Paquets de `node_modules` atteints statiquement. */
  packages: Set<string>;
}

function walkEntryGraph(): EntryGraph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTRY];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    files.add(path.relative(SRC, file).split(path.sep).join('/'));
    if (LEAF.test(file)) continue;
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveSpec(file, spec);
        if (resolved) queue.push(resolved);
        continue;
      }
      // Package: we note its name (with the `@scope/name` scope) and stop there.
      const parts = spec.split('/');
      packages.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  return { files, packages };
}

describe('first-load graph', () => {
  const graph = walkEntryGraph();

  it('starts from main.jsx and reaches the shell', () => {
    // Guard against the guard: a walk that found nothing would pass all the
    // prohibitions below without checking anything.
    expect(graph.files.has('v2/App.tsx')).toBe(true);
    expect(graph.files.has('v2/components/Shell.tsx')).toBe(true);
    expect(graph.packages.has('react')).toBe(true);
  });

  it.each([
    ['framer-motion', '38,5 ko gzip pour trois apparitions et un soulignement d’onglet (F3)'],
    ['marked', '13,5 ko gzip pour le panneau « Nouveautés » (F6)'],
    ['@dnd-kit/core', '16,8 ko gzip pour le réagencement des tuiles d’accueil (F5)'],
    ['@dnd-kit/sortable', 'idem F5'],
    ['@dnd-kit/utilities', 'idem F5'],
    ['hash-wasm', '7,6 ko gzip alors que le hachage se fait dans un worker (F15)'],
  ])('ne charge pas %s (%s)', (pkg) => {
    expect([...graph.packages]).not.toContain(pkg);
  });

  it('does not embed the project page, its tabs, nor the ShotGrid panels (F4)', () => {
    const fautifs = [...graph.files].filter(
      (f) =>
        f === 'v2/pages/ProjectPage.tsx' ||
        f.startsWith('v2/pages/project/') ||
        f.startsWith('v2/components/shotgrid/') ||
        f === 'v2/components/ProjectSettingsTab.tsx',
    );
    expect(fautifs).toEqual([]);
  });

  it('does not embed the markdown rendering of the documentation (F6)', () => {
    expect(graph.files.has('v2/pages/docs/docsRender.ts')).toBe(false);
  });
});
