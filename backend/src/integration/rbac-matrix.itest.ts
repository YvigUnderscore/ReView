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
 * Authorization matrix engine.
 *
 * It contains no business knowledge: everything lives in `rbacMatrix.ts`. Adding an endpoint to
 * cover therefore never requires touching this file, which was the condition set by the audit
 * ("write it so it is easy to extend").
 */
const app = createApp({ rateLimit: false });

let fixture: RbacFixture;

beforeAll(async () => {
  fixture = await buildRbacFixture(app);
}, 120_000);

/** Plays a case with the given actor and returns the HTTP status code. */
async function play(testCase: MatrixCase, actor: Actor): Promise<number> {
  const values = placeholders(fixture);
  const url = substitute(testCase.path, values);
  let req = request(app)[testCase.method](url);
  if (actor !== 'anon') req = req.set('Authorization', `Bearer ${fixture.tokens[actor]}`);
  const body = substituteBody(testCase.body, values);
  if (body) req = req.send(body);
  return (await req).status;
}

/** Label of a case: what will be read in the failure report. */
const label = (c: MatrixCase): string => `${c.method.toUpperCase()} ${c.path} — ${c.guard}`;

describe('Authorisation matrix — four roles, two disjoint projects', () => {
  it('the scenery is complete: four roles, two projects, entities on both sides', () => {
    expect(fixture.projectA).not.toBe(fixture.projectB);
    for (const actor of AUTHENTICATED_ACTORS) expect(fixture.tokens[actor]).toBeTruthy();
    expect(fixture.shotA).toBeGreaterThan(0);
    expect(fixture.versionB).toBeGreaterThan(0);
  });

  it('the table does not contain the same method and path pair twice', () => {
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
          // Exactly 403: a 401 would signal lost authentication, a 404 a different policy
          // (defensible, but it must be written in the table).
          expect(status, `${label(testCase)} [${actor}]`).toBe(403);
        } else {
          expect(status, `${label(testCase)} [${actor}]`).toBeLessThan(400);
        }
      });
    }

    if (!testCase.public) {
      it('anonymous → 401', async () => {
        expect(await play(testCase, 'anon'), `${label(testCase)} [anon]`).toBe(401);
      });
    }
  });
});
