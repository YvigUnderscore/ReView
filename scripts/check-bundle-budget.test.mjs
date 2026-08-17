// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ENTRY_BUDGET_GZIP, entryScriptFrom } from './check-bundle-budget.mjs';

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
