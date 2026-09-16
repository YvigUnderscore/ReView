// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Grandeur mesurée : le nombre d'arêtes d'import **statique** menant de la page de review
 * à `hls.js`. Elle doit valoir zéro.
 *
 * Rollup découpe les chunks d'après ce graphe : tant qu'un seul module de la fermeture
 * statique de `/review/:id` importait `hls.js`, les 510 ko du lecteur adaptatif étaient
 * téléchargés et parsés avant l'affichage de N'IMPORTE QUELLE review — image, 3D, splat
 * comprises, alors que `VideoPane` n'y est jamais monté. Un `import()` suffit à l'en
 * sortir ; un `import` statique remis un jour par mégarde (dans un hook voisin, dans un
 * panneau) l'y remettrait sans que rien ne se voie à l'écran. D'où ce test, qui relit le
 * graphe des sources plutôt que la sortie du build — il tourne en une milliseconde et ne
 * demande pas de `vite build`.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const ENTRY = join(SRC, 'v2/pages/ReviewPage.tsx');
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', ''];

/** Retire commentaires de bloc et de ligne : un import commenté n'est pas une arête. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Spécificateurs importés **statiquement** par un fichier. `import type` est exclu (effacé
 * au build, donc sans effet sur le graphe de chunks), `import(...)` aussi — c'est
 * précisément la forme recherchée.
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

/** Fichier sur disque correspondant à un spécificateur relatif, ou `null` s'il n'en a pas. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = join(dirname(fromFile), spec);
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        /* répertoire : on continue */
      }
    }
  }
  return null;
}

/** Fermeture des imports statiques depuis `entry` : fichiers visités et paquets atteints. */
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
      // Paquet npm : on retient qui l'importe, pour que l'échec nomme le coupable.
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      packages.set(pkg, [...(packages.get(pkg) ?? []), file.slice(SRC.length + 1).replace(/\\/g, '/')]);
    }
  }
  return { files, packages };
}

describe('graphe d’imports de /review/:id', () => {
  const { files, packages } = staticClosure(ENTRY);

  it('atteint bien le lecteur vidéo (sinon le test ne prouverait rien)', () => {
    const reached = [...files].map((f) => f.replace(/\\/g, '/'));
    expect(reached.some((f) => f.endsWith('/review/VideoPane.tsx'))).toBe(true);
    expect(reached.some((f) => f.endsWith('/review/useHlsPlayer.ts'))).toBe(true);
    // Sanity : un paquet réellement nécessaire au premier écran est bien vu par le marcheur.
    expect(packages.has('react')).toBe(true);
  });

  it('n’atteint hls.js par AUCUN import statique', () => {
    expect(packages.get('hls.js') ?? []).toEqual([]);
  });

  it('le charge bien à la demande — la lecture adaptative n’a pas disparu', () => {
    const runtime = readFileSync(join(SRC, 'v2/pages/review/hlsRuntime.ts'), 'utf8');
    // `.then` : la forme VALEUR du `import()`, pas le `typeof import('hls.js')` des types.
    expect(stripComments(runtime)).toMatch(/import\(\s*['"]hls\.js['"]\s*\)\s*\.then/);
  });
});
