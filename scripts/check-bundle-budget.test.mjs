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
  it('extracts the entry module and strips the leading slash', () => {
    const html = '<html><body><script type="module" crossorigin src="/assets/index-abc.js"></script>';
    expect(entryScriptFrom(html)).toBe('assets/index-abc.js');
  });

  it('ignores non-module scripts', () => {
    expect(entryScriptFrom('<script src="/legacy.js"></script>')).toBeNull();
  });

  it('returns null when there is no script', () => {
    expect(entryScriptFrom('<html><body></body></html>')).toBeNull();
  });

  it('keeps the first declared module', () => {
    const html = '<script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>';
    expect(entryScriptFrom(html)).toBe('a.js');
  });
});

describe('ENTRY_BUDGET_GZIP', () => {
  it('remains a plausible ceiling, not a neutralised value', () => {
    expect(ENTRY_BUDGET_GZIP).toBeGreaterThan(100_000);
    expect(ENTRY_BUDGET_GZIP).toBeLessThan(2_000_000);
  });
});

describe('preloadedScriptsFrom', () => {
  it('counts the entry and its preloaded modules', () => {
    // Measuring only the entry file would be misleading since the split: moving
    // React into a chunk would make the figure "drop" without changing anything for the reader.
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

  it('does not count a file that is both preloaded and referenced twice', () => {
    const html =
      '<link rel="modulepreload" href="/assets/index.js"><script type="module" src="/assets/index.js"></script>';
    expect(preloadedScriptsFrom(html)).toEqual(['assets/index.js']);
  });

  it('returns an empty list when the page loads no module', () => {
    expect(preloadedScriptsFrom('<html><body>rien</body></html>')).toEqual([]);
  });
});

describe('stylesheetsFrom', () => {
  it('keeps the stylesheet, which blocks the first screen from rendering', () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index-Bn0z7Js3.css">';
    expect(stylesheetsFrom(html)).toEqual(['assets/index-Bn0z7Js3.css']);
  });

  it('does not depend on the generator\'s attribute order', () => {
    expect(stylesheetsFrom('<link href="/a.css" rel="stylesheet">')).toEqual(['a.css']);
  });

  it('leaves aside the links that load no style', () => {
    const html = [
      '<link rel="icon" type="image/png" href="/logo_banner.png" />',
      '<link rel="manifest" href="/manifest.json" />',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-react.js">',
    ].join('\n');
    expect(stylesheetsFrom(html)).toEqual([]);
  });
});

/** `index.html` as Vite writes it today: three scripts and a stylesheet. */
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
  it('counts the four files nginx serves before the first screen', () => {
    // The safeguard only counted three: the stylesheet was excluded although
    // it blocks rendering just like the entry script.
    expect(firstLoadAssetsFrom(REAL_INDEX)).toEqual([
      'assets/index-CenkDGFE.js',
      'assets/vendor-react-kGgTSL4I.js',
      'assets/vendor-data-C8QA3gpJ.js',
      'assets/index-Bn0z7Js3.css',
    ]);
  });

  it('always includes at least what the previous count included', () => {
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

  // Hardly compressible contents (xorshift32): the gzip of a repetitive text would fit in
  // a few bytes and the measure would prove nothing.
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

  it('weighs the four files, stylesheet included', () => {
    const dist = makeDist(REAL_INDEX, files);
    const measured = measureFirstLoad(dist);
    const expected = Object.values(files).reduce((n, c) => n + gzipSync(Buffer.from(c)).length, 0);
    expect(measured.files).toHaveLength(4);
    expect(measured.bytes).toBe(expected);
  });

  it('the CSS bytes were missing from the count: they weigh something, and they are counted', () => {
    const dist = makeDist(REAL_INDEX, files);
    const cssBytes = gzipSync(Buffer.from(css)).length;
    const scriptsOnly = preloadedScriptsFrom(REAL_INDEX).reduce(
      (n, f) => n + gzipSync(Buffer.from(files[f])).length,
      0,
    );
    expect(cssBytes).toBeGreaterThan(1000);
    expect(measureFirstLoad(dist).bytes).toBe(scriptsOnly + cssBytes);
  });

  it('reports an external resource instead of dropping it from the count', () => {
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
