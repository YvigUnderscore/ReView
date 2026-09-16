// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ENTRY_BUDGET_GZIP,
  entryScriptFrom,
  firstLoadAssetsFrom,
  measureFirstLoad,
  preloadedScriptsFrom,
  stylesheetsFrom,
} from './check-bundle-budget.mjs';

describe('entryScriptFrom', () => {
  it('extrait le module d’entrée et retire la barre initiale', () => {
    const html = '<html><body><script type="module" crossorigin src="/assets/index-abc.js"></script>';
    expect(entryScriptFrom(html)).toBe('assets/index-abc.js');
  });

  it('ignore les scripts non modulaires', () => {
    expect(entryScriptFrom('<script src="/legacy.js"></script>')).toBeNull();
  });

  it('renvoie null quand il n’y a pas de script', () => {
    expect(entryScriptFrom('<html><body></body></html>')).toBeNull();
  });

  it('retient le premier module déclaré', () => {
    const html = '<script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>';
    expect(entryScriptFrom(html)).toBe('a.js');
  });
});

describe('ENTRY_BUDGET_GZIP', () => {
  it('reste un plafond plausible, pas une valeur neutralisée', () => {
    expect(ENTRY_BUDGET_GZIP).toBeGreaterThan(100_000);
    expect(ENTRY_BUDGET_GZIP).toBeLessThan(2_000_000);
  });
});

describe('preloadedScriptsFrom', () => {
  it('compte l’entrée et ses modules préchargés', () => {
    // Ne mesurer que le fichier d'entrée serait trompeur depuis le découpage : sortir
    // React dans un chunk ferait « baisser » le chiffre sans rien changer pour le lecteur.
    const html = [
      '<link rel="modulepreload" href="/assets/vendor-react.js">',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-data.js">',
      '<script type="module" crossorigin src="/assets/index.js"></script>',
    ].join('\n');
    expect(preloadedScriptsFrom(html)).toEqual([
      'assets/index.js',
      'assets/vendor-react.js',
      'assets/vendor-data.js',
    ]);
  });

  it('ne compte pas deux fois un fichier préchargé et référencé', () => {
    const html =
      '<link rel="modulepreload" href="/assets/index.js"><script type="module" src="/assets/index.js"></script>';
    expect(preloadedScriptsFrom(html)).toEqual(['assets/index.js']);
  });

  it('rend une liste vide quand la page ne charge aucun module', () => {
    expect(preloadedScriptsFrom('<html><body>rien</body></html>')).toEqual([]);
  });
});

describe('stylesheetsFrom', () => {
  it('retient la feuille de style, qui bloque le rendu du premier écran', () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index-Bn0z7Js3.css">';
    expect(stylesheetsFrom(html)).toEqual(['assets/index-Bn0z7Js3.css']);
  });

  it('ne dépend pas de l’ordre des attributs du générateur', () => {
    expect(stylesheetsFrom('<link href="/a.css" rel="stylesheet">')).toEqual(['a.css']);
  });

  it('laisse de côté les liens qui ne chargent pas de style', () => {
    const html = [
      '<link rel="icon" type="image/png" href="/logo_banner.png" />',
      '<link rel="manifest" href="/manifest.json" />',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-react.js">',
    ].join('\n');
    expect(stylesheetsFrom(html)).toEqual([]);
  });
});

/** `index.html` tel que Vite l'écrit aujourd'hui : trois scripts et une feuille de style. */
const REAL_INDEX = [
  '<!doctype html>',
  '<html lang="en" class="dark"><head>',
  '<link rel="icon" type="image/png" href="/logo_banner.png" />',
  '<link rel="manifest" href="/manifest.json" />',
  '<title>ReView</title>',
  '<script type="module" crossorigin src="/assets/index-CenkDGFE.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/vendor-react-kGgTSL4I.js">',
  '<link rel="modulepreload" crossorigin href="/assets/vendor-data-C8QA3gpJ.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index-Bn0z7Js3.css">',
  '</head><body><div id="root"></div></body></html>',
].join('\n');

describe('firstLoadAssetsFrom', () => {
  it('compte les quatre fichiers que nginx sert avant le premier écran', () => {
    // Le garde-fou n'en comptait que trois : la feuille de style était exclue alors
    // qu'elle bloque le rendu au même titre que le script d'entrée.
    expect(firstLoadAssetsFrom(REAL_INDEX)).toEqual([
      'assets/index-CenkDGFE.js',
      'assets/vendor-react-kGgTSL4I.js',
      'assets/vendor-data-C8QA3gpJ.js',
      'assets/index-Bn0z7Js3.css',
    ]);
  });

  it('inclut toujours au moins ce que comptait le décompte précédent', () => {
    for (const file of preloadedScriptsFrom(REAL_INDEX)) {
      expect(firstLoadAssetsFrom(REAL_INDEX)).toContain(file);
    }
  });
});

describe('measureFirstLoad', () => {
  const dirs = [];
  const makeDist = (html, files) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-bundle-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), html);
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  // Contenus peu compressibles (xorshift32) : le gzip d'un texte répétitif tiendrait en
  // quelques octets et la mesure ne prouverait rien.
  const noise = (seed, size) => {
    let x = seed | 0 || 1;
    let s = '';
    for (let i = 0; i < size; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      s += String.fromCharCode(33 + ((x >>> 0) % 90));
    }
    return s;
  };
  const css = noise(3, 4000);
  const files = {
    'assets/index-CenkDGFE.js': noise(1, 20000),
    'assets/vendor-react-kGgTSL4I.js': noise(2, 8000),
    'assets/vendor-data-C8QA3gpJ.js': noise(5, 3000),
    'assets/index-Bn0z7Js3.css': css,
  };

  it('pèse les quatre fichiers, feuille de style comprise', () => {
    const dist = makeDist(REAL_INDEX, files);
    const measured = measureFirstLoad(dist);
    const expected = Object.values(files).reduce((n, c) => n + gzipSync(Buffer.from(c)).length, 0);
    expect(measured.files).toHaveLength(4);
    expect(measured.bytes).toBe(expected);
  });

  it('les octets de la CSS manquaient au décompte : ils pèsent, et ils sont comptés', () => {
    const dist = makeDist(REAL_INDEX, files);
    const cssBytes = gzipSync(Buffer.from(css)).length;
    const scriptsOnly = preloadedScriptsFrom(REAL_INDEX).reduce(
      (n, f) => n + gzipSync(Buffer.from(files[f])).length,
      0,
    );
    expect(cssBytes).toBeGreaterThan(1000);
    expect(measureFirstLoad(dist).bytes).toBe(scriptsOnly + cssBytes);
  });

  it('signale une ressource externe au lieu de l’escamoter du décompte', () => {
    const html = `${REAL_INDEX.replace(
      '</head>',
      '<link rel="stylesheet" href="https://cdn.example/x.css"></head>',
    )}`;
    const dist = makeDist(html, files);
    const measured = measureFirstLoad(dist);
    expect(measured.external).toEqual(['https://cdn.example/x.css']);
    expect(measured.files).toHaveLength(4);
  });
});
