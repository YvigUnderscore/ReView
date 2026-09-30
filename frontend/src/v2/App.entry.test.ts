// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Ce qu'il y a dans le **premier chargement**, mesuré sur le graphe d'imports statiques.
 *
 * Le budget en octets (`scripts/check-bundle-budget.mjs`) dit qu'on a dépassé ; il ne dit
 * jamais *quoi*. Or une seule ligne suffit à ramener une bibliothèque entière dans le
 * fichier d'entrée : un `import { motion } from 'framer-motion'` ajouté à un composant de
 * la coquille, un onglet repassé en import statique « pour aller plus vite ». Le mal est
 * fait au commit d'après, sur un changement sans rapport, et personne ne fait le lien.
 *
 * Ce test-ci parcourt exactement ce que le navigateur télécharge avant d'exécuter quoi que
 * ce soit : `main.jsx` et la fermeture de ses imports **statiques** — les `import()`
 * dynamiques, eux, sont des chunks à part et s'arrêtent donc la marche. Chaque interdit
 * porte le poids gzip qu'il a coûté, mesuré sur un build réel.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(SRC, 'main.jsx');

/** Extensions tentées dans l'ordre, à la manière du résolveur de Vite. */
const CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'];

/** Les fichiers qu'on ne parcourt pas : ils n'ont pas d'imports à suivre. */
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
 * Spécificateurs importés **statiquement** par un fichier.
 *
 * Les trois formes qui produisent du code au chargement : `import … from`, `import 'x'`
 * (effet de bord) et `export … from` (ré-export). `import type` est écarté — TypeScript
 * l'efface — et `import('x')`, qui n'est jamais en début de ligne suivi d'un espace, ne
 * peut pas être confondu avec les précédentes.
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
  /** Fichiers du dépôt, en chemin relatif à `src/`, séparateurs `/`. */
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
      // Paquet : on note son nom (avec la portée `@scope/nom`) et on s'arrête là.
      const parts = spec.split('/');
      packages.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  return { files, packages };
}

describe('graphe du premier chargement', () => {
  const graph = walkEntryGraph();

  it('part bien de main.jsx et atteint la coquille', () => {
    // Garde-fou du garde-fou : un parcours qui ne trouverait plus rien passerait tous les
    // interdits ci-dessous sans rien vérifier.
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

  it('n’embarque ni la page projet, ni ses onglets, ni les panneaux ShotGrid (F4)', () => {
    const fautifs = [...graph.files].filter(
      (f) =>
        f === 'v2/pages/ProjectPage.tsx' ||
        f.startsWith('v2/pages/project/') ||
        f.startsWith('v2/components/shotgrid/') ||
        f === 'v2/components/ProjectSettingsTab.tsx',
    );
    expect(fautifs).toEqual([]);
  });

  it('n’embarque pas le rendu markdown de la documentation (F6)', () => {
    expect(graph.files.has('v2/pages/docs/docsRender.ts')).toBe(false);
  });
});
