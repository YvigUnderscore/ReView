// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The checks added to `validate.sh` are themselves under control.
 *
 * The validation suite is a protected principle: "every change must extend it, never
 * weaken it". A principle that is not executed is lost at the first rewrite — this
 * file therefore checks that the steps exist, that they are not neutralised by a
 * `|| true`, and that CI does require those that can only run there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');

const VALIDATE = read('scripts/validate.sh');
const WORKFLOW = read('.github/workflows/validate.yml');

describe('validate.sh — étapes du lot « vert veut dire que ça marche »', () => {
  it('contrôle la dérive entre schema.prisma et les migrations', () => {
    expect(VALIDATE).toMatch(/node "\$ROOT\/scripts\/check-prisma-drift\.mjs"/);
  });

  it('mesure la couverture des deux paquets et la confronte à ses planchers', () => {
    expect(VALIDATE).toMatch(/check-coverage\.mjs" backend/);
    expect(VALIDATE).toMatch(/check-coverage\.mjs" frontend/);
    // The measurement replaces the bare `npm test` when the provider is there: never in addition, never
    // in place of the check. Both branches do run the tests.
    expect(VALIDATE).toMatch(/npx vitest run --coverage/);
  });

  it('fait entrer les scripts Python des workers dans la chaîne qualité', () => {
    expect(VALIDATE).toMatch(/-m compileall/);
    expect(VALIDATE).toMatch(/backend\/src\/workers\/usd/);
    expect(VALIDATE).toMatch(/backend\/src\/workers\/ocio/);
    // The check must not litter the repository with `__pycache__`.
    expect(VALIDATE).toMatch(/PYTHONPYCACHEPREFIX=/);
  });

  it('sait lancer le harnais ShotGrid, en option', () => {
    expect(VALIDATE).toMatch(/--with-shotgrid/);
    expect(VALIDATE).toMatch(/node "\$ROOT\/scripts\/run-shotgrid-e2e\.mjs"/);
  });

  it('accepte les options cumulées et refuse une option inconnue', () => {
    expect(VALIDATE).toMatch(/for arg in "\$@"/);
    expect(VALIDATE).toMatch(/Option inconnue/);
  });

  it('n’avale aucun échec : pas de `|| true` sur une étape de contrôle', () => {
    const neutralized = VALIDATE.split('\n').filter(
      (line) => /\|\|\s*true/.test(line) && /node |npm |npx |ruff |compileall/.test(line),
    );
    expect(neutralized).toEqual([]);
  });

  it('s’arrête au premier rouge', () => {
    expect(VALIDATE).toMatch(/^set -euo pipefail$/m);
  });
});

describe('CI — le job d’intégration compte à nouveau', () => {
  it('n’est plus complaisant : aucun job ne porte continue-on-error', () => {
    // The directive, not the word: the workflow comment explains why it was skipped.
    expect(WORKFLOW).not.toMatch(/^\s*continue-on-error\s*:/m);
  });

  it('exige le contrôle de dérive, puisqu’il est le seul à disposer d’une base', () => {
    expect(WORKFLOW).toMatch(/REVIEW_REQUIRE_DRIFT_CHECK: '1'/);
  });
});
