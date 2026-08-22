// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { AUTHENTICATED_ACTORS, buildRbacFixture, type Actor, type RbacFixture } from './rbacFixture';
import {
  AUTHORIZATION_MATRIX,
  placeholders,
  substitute,
  substituteBody,
  type MatrixCase,
} from './rbacMatrix';

/**
 * Moteur de la matrice d'autorisation.
 *
 * Il ne contient aucune connaissance métier : tout est dans `rbacMatrix.ts`. Ajouter un
 * endpoint à couvrir n'oblige donc jamais à toucher ce fichier — c'était la condition posée
 * par l'audit (« écris-le pour qu'il soit facile à étendre »).
 */
const app = createApp({ rateLimit: false });

let fixture: RbacFixture;

beforeAll(async () => {
  fixture = await buildRbacFixture(app);
}, 120_000);

/** Joue un cas avec l'acteur donné et rend le code HTTP. */
async function play(testCase: MatrixCase, actor: Actor): Promise<number> {
  const values = placeholders(fixture);
  const url = substitute(testCase.path, values);
  let req = request(app)[testCase.method](url);
  if (actor !== 'anon') req = req.set('Authorization', `Bearer ${fixture.tokens[actor]}`);
  const body = substituteBody(testCase.body, values);
  if (body) req = req.send(body);
  return (await req).status;
}

/** Étiquette d'un cas : ce qu'on lira dans le rapport d'échec. */
const label = (c: MatrixCase): string => `${c.method.toUpperCase()} ${c.path} — ${c.guard}`;

describe('Matrice d’autorisation — quatre rôles, deux projets disjoints', () => {
  it('le décor est complet : quatre rôles, deux projets, des entités des deux côtés', () => {
    expect(fixture.projectA).not.toBe(fixture.projectB);
    for (const actor of AUTHENTICATED_ACTORS) expect(fixture.tokens[actor]).toBeTruthy();
    expect(fixture.shotA).toBeGreaterThan(0);
    expect(fixture.versionB).toBeGreaterThan(0);
  });

  it('la table ne contient pas deux fois le même couple méthode + chemin', () => {
    const seen = AUTHORIZATION_MATRIX.map((c) => `${c.method} ${c.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  describe.each(AUTHORIZATION_MATRIX.map((c) => [label(c), c] as const))('%s', (_name, testCase) => {
    for (const actor of AUTHENTICATED_ACTORS) {
      const expected = testCase.expect[actor];
      if (!expected) continue;
      it(`${actor} → ${expected}`, async () => {
        const status = await play(testCase, actor);
        if (expected === 'deny') {
          // Exactement 403 : un 401 signalerait une authentification perdue, un 404 une
          // autre politique (défendable, mais elle s'écrit dans la table).
          expect(status, `${label(testCase)} [${actor}]`).toBe(403);
        } else {
          expect(status, `${label(testCase)} [${actor}]`).toBeLessThan(400);
        }
      });
    }

    if (!testCase.public) {
      it('anonyme → 401', async () => {
        expect(await play(testCase, 'anon'), `${label(testCase)} [anon]`).toBe(401);
      });
    }
  });
});
