// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (fichier: string) => readFileSync(path.join(ici, fichier), 'utf8');

/**
 * Garde-fou d'architecture, pas de comportement.
 *
 * `IconButton` est sur le chemin d'entrée : tout ce qu'il importe statiquement entre dans le
 * **premier chargement**. Quand Radix Tooltip y était, le budget passait de 419 à 429,8 ko
 * pour un plafond de 430 — 0,2 ko de marge, et le changement suivant, quel qu'il soit,
 * faisait échouer la suite.
 *
 * La façade existe pour cela et pour rien d'autre. Elle est courte, elle a l'air d'une
 * indirection gratuite, et quelqu'un la « simplifiera » un jour en réimportant Radix
 * directement — le budget ne se plaindra qu'au commit d'après, sur un changement sans
 * rapport. Ce test-ci le dit tout de suite, et dit pourquoi.
 */
describe('la façade d’infobulle tient Radix hors du premier chargement', () => {
  it('n’importe Radix que dynamiquement', () => {
    const facade = lire('tooltip.tsx');
    expect(facade).not.toMatch(/import\s+[^;]*from\s+['"]@radix-ui\/react-tooltip['"]/);
    // L'import dynamique, lui, est attendu : c'est le mécanisme même.
    expect(facade).toMatch(/import\(['"]\.\/tooltip\.radix['"]\)/);
  });

  it('garde l’implémentation Radix dans un module séparé', () => {
    expect(lire('tooltip.radix.tsx')).toMatch(/from ['"]@radix-ui\/react-tooltip['"]/);
  });

  /**
   * `IconButton` est le seul point d'entrée universel : s'il importait l'implémentation, la
   * façade ne servirait plus à rien.
   */
  it('n’est jamais court-circuitée par IconButton', () => {
    const bouton = lire('icon-button.tsx');
    expect(bouton).toMatch(/from ['"]\.\/tooltip['"]/);
    expect(bouton).not.toMatch(/tooltip\.radix/);
    expect(bouton).not.toMatch(/@radix-ui\/react-tooltip/);
  });
});
