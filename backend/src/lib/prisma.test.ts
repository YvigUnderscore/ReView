// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { withPoolBounds } from './prisma';

/**
 * PERF-04 / INFRA-10 — le pool ne doit plus suivre le matériel.
 *
 * Mesuré sur la base de développement (32 cœurs logiques vus par le process) : 20 requêtes
 * concurrentes lancées sur une URL NUE ouvrent 20 connexions PostgreSQL et rendent
 * `statement_timeout = 0` ; la même charge sur l'URL bornée ci-dessous en ouvre 10 et rend
 * `statement_timeout = 1min`. Ces cas fixent la forme exacte de l'URL qui produit ce
 * résultat — l'encodage de `options` en particulier, qu'un passage par `URLSearchParams`
 * casserait en silence (espace écrit « + », jeton inconnu côté serveur).
 */
const BASE = 'postgresql://review:pw@postgres:5432/review?schema=public';

describe('withPoolBounds', () => {
  it('borne le pool, l’attente et la durée d’une requête', () => {
    expect(withPoolBounds(BASE, {})).toBe(
      `${BASE}&connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000`,
    );
  });

  it('encode l’espace en %20 et non en « + » (le serveur découpe `options` sur les espaces)', () => {
    const url = withPoolBounds(BASE, {}) ?? '';
    expect(url).toContain('options=-c%20statement_timeout%3D60000');
    expect(url).not.toContain('+');
  });

  it('ouvre la query quand l’URL n’en a pas', () => {
    expect(withPoolBounds('postgresql://u:p@h:5432/db', {})).toBe(
      'postgresql://u:p@h:5432/db?connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000',
    );
  });

  it('laisse intact tout paramètre déjà posé par l’exploitant', () => {
    // Le compose écrit déjà `connection_limit`/`pool_timeout` dans les deux DATABASE_URL :
    // les réécrire ici transformerait un réglage lisible en valeur fantôme.
    const explicit = `${BASE}&connection_limit=4&pool_timeout=5&options=-c%20statement_timeout%3D10000`;
    expect(withPoolBounds(explicit, {})).toBeUndefined();
  });

  it('ne complète que ce qui manque', () => {
    expect(withPoolBounds(`${BASE}&connection_limit=4`, {})).toBe(
      `${BASE}&connection_limit=4&pool_timeout=20&options=-c%20statement_timeout%3D60000`,
    );
  });

  it('suit DB_POOL, DB_POOL_TIMEOUT et DB_STATEMENT_TIMEOUT_MS', () => {
    expect(
      withPoolBounds(BASE, { DB_POOL: '4', DB_POOL_TIMEOUT: '30', DB_STATEMENT_TIMEOUT_MS: '5000' }),
    ).toBe(`${BASE}&connection_limit=4&pool_timeout=30&options=-c%20statement_timeout%3D5000`);
  });

  it('ignore une valeur d’environnement qui n’est pas un entier positif', () => {
    // Un `DB_POOL=0` ou `DB_POOL=abc` posé par mégarde ne doit pas produire une URL que
    // Prisma refuse au démarrage : on retombe sur le défaut.
    for (const bad of ['0', '-3', 'abc', '', '2.5']) {
      expect(withPoolBounds(BASE, { DB_POOL: bad }), bad).toContain('connection_limit=10');
    }
  });

  it('ne touche pas une URL qui n’est pas une connexion PostgreSQL', () => {
    expect(withPoolBounds(undefined, {})).toBeUndefined();
    expect(withPoolBounds('', {})).toBeUndefined();
    expect(withPoolBounds('mysql://u:p@h/db', {})).toBeUndefined();
  });

  it('ne prend pas un « ? » du mot de passe pour le début de la query', () => {
    // Un mot de passe mal encodé ferait sinon passer la moitié des identifiants pour des
    // paramètres, et l'URL produite serait inconnectable.
    expect(withPoolBounds('postgresql://u:pa?ss@h:5432/db', {})).toBe(
      'postgresql://u:pa?ss@h:5432/db?connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000',
    );
  });
});
