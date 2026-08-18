// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ENTRY_BUDGET_GZIP, entryScriptFrom, preloadedScriptsFrom } from './check-bundle-budget.mjs';

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
