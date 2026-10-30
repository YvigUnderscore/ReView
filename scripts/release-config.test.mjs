// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants of the publication chain: release workflow, root CHANGELOG, stack
 * of published images, and monitoring (targets, alert rules, dashboard).
 *
 * What is locked down here is what makes a version *installable by a third party*: nothing
 * is published without the validation suite, no version ships without notes, no image
 * runs in production under a moving tag, and the alerts really exist
 * instead of being suggested in a documentation page.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const RELEASE = read('.github/workflows/release.yml');
const CHANGELOG = read('CHANGELOG.md');
const COMPOSE_RELEASE = read('docker-compose.release.yml');
const PROMETHEUS = read('monitoring/prometheus.yml');
const RULES = read('monitoring/rules/alerts.yml');
const DASHBOARD = JSON.parse(read('monitoring/grafana/provisioning/dashboards/review-dashboard.json'));

/** Alert blocks of the rules file, split on "- alert:". */
export function alertBlocks(rules) {
  const parts = rules.split(/^\s*- alert: /m).slice(1);
  return parts.map((part) => ({ name: part.split('\n')[0].trim(), body: part }));
}

describe('workflow de release', () => {
  it('se déclenche sur une étiquette de version', () => {
    expect(RELEASE).toMatch(/tags: \['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/);
  });

  it('exige une entrée de CHANGELOG avant de publier quoi que ce soit', () => {
    expect(RELEASE).toMatch(/grep -q "\^## \$version "/);
    expect(RELEASE).toMatch(/needs: guard/);
  });

  it('rejoue la suite de validation entière, sans la neutraliser', () => {
    // Outside comments: it is the executed command that is checked, not what it says about itself.
    const invocations = RELEASE.split('\n').filter(
      (l) => !l.trim().startsWith('#') && l.includes('scripts/validate.sh'),
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatch(/^ +run: bash scripts\/validate\.sh$/);
    expect(RELEASE).not.toMatch(/continue-on-error/);
  });

  it('ne construit les images qu’après la validation', () => {
    expect(RELEASE).toMatch(/needs: \[guard, validate\]/);
  });

  it('publie les trois images du produit', () => {
    for (const image of ['review-backend', 'review-worker', 'review-frontend']) {
      expect(RELEASE, image).toContain(`image: ${image}`);
    }
    // The worker is the only image to bundle Blender + USD.
    expect(RELEASE).toMatch(
      /image: review-worker\n +context: \.\/backend\n +dockerfile: \.\/backend\/Dockerfile\n +usd: '1'/,
    );
  });

  it('étiquette les images par version et injecte la version dans la construction', () => {
    expect(RELEASE).toMatch(/:\$\{\{ needs\.guard\.outputs\.version \}\}/);
    expect(RELEASE).toMatch(/APP_VERSION=\$\{\{ needs\.guard\.outputs\.version \}\}/);
    expect(RELEASE).toMatch(/GIT_SHA=\$\{\{ github\.sha \}\}/);
    expect(RELEASE).toMatch(/org\.opencontainers\.image\.licenses=AGPL-3\.0-or-later/);
  });

  it('publie sous une référence d’image valide : aucune majuscule dans le chemin', () => {
    // An OCI reference does not accept an uppercase letter: "ghcr.io/YvigUnderscore/review-backend"
    // is invalid. The workflow interpolated `github.repository_owner`, which renders the login as
    // it is written — so the registry mode had never been able to publish a single image.
    const tagLines = RELEASE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('${{ env.REGISTRY }}/'));
    expect(tagLines.length).toBeGreaterThan(0);
    for (const line of tagLines) {
      expect(line, line).toContain('needs.guard.outputs.owner');
    }
    expect(RELEASE).toMatch(/owner=\$\{GITHUB_REPOSITORY_OWNER,,\}/);
  });

  it('déclare dans l’image les build-args de version qu’il lui passe', () => {
    // An undeclared build-arg is ignored WITHOUT a word. Without these three `ARG`s, every image
    // published answered "commit: null, builtAt: null" on /api/version: an instance
    // unable to name itself, whereas AGPL §13 assumes knowing which commit it
    // correspond.
    const backendDockerfile = read('backend/Dockerfile');
    for (const arg of ['APP_VERSION', 'GIT_SHA', 'BUILD_DATE']) {
      expect(backendDockerfile, arg).toMatch(new RegExp(`^ARG ${arg}=`, 'm'));
      expect(RELEASE, arg).toContain(`${arg}=`);
    }
    expect(backendDockerfile).toMatch(/^ENV APP_VERSION=\$APP_VERSION/m);
  });

  it('ne demande les droits d’écriture que là où ils servent', () => {
    expect(RELEASE).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(RELEASE).toMatch(/packages: write/);
    expect(RELEASE).toMatch(/contents: write/);
  });

  it('reste sans effet en essai à blanc (workflow_dispatch)', () => {
    expect(RELEASE).toMatch(/push: \$\{\{ needs\.guard\.outputs\.publish == 'true' \}\}/);
    expect(RELEASE).toMatch(/if: needs\.guard\.outputs\.publish == 'true'/);
  });
});

describe('CHANGELOG racine', () => {
  it('renvoie aux notes produit au lieu de les recopier', () => {
    expect(CHANGELOG).toContain('DOCUMENTATION/CHANGELOG.md');
    expect(CHANGELOG).toMatch(/does not duplicate/i);
  });

  it('annonce le format que le workflow contrôle', () => {
    expect(CHANGELOG).toMatch(/## vX\.Y\.Z — YYYY-MM-DD/);
    expect(CHANGELOG).toMatch(/^## Unreleased$/m);
  });

  it('n’est pas le miroir du changelog produit', () => {
    const product = read('DOCUMENTATION/CHANGELOG.md');
    const productHeadings = [...product.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const rootHeadings = [...CHANGELOG.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(rootHeadings.filter((h) => productHeadings.includes(h))).toEqual([]);
  });
});

describe('docker-compose.release.yml', () => {
  it('fait tourner les images publiées plutôt que des constructions locales', () => {
    for (const image of ['review-backend', 'review-worker', 'review-frontend']) {
      expect(COMPOSE_RELEASE, image).toContain(`/${image}:`);
    }
  });

  it('exige une étiquette explicite : pas de « latest » en production', () => {
    expect(COMPOSE_RELEASE).not.toMatch(/:latest/);
    expect(COMPOSE_RELEASE).toMatch(/REVIEW_IMAGE_TAG:\?/);
    expect(COMPOSE_RELEASE).toMatch(/REVIEW_IMAGE_PREFIX:\?/);
  });
});

describe('supervision', () => {
  it('scrute le worker autant que l’API', () => {
    expect(PROMETHEUS).toMatch(/job_name: review-backend/);
    expect(PROMETHEUS).toMatch(/job_name: review-worker/);
    expect(PROMETHEUS).toMatch(/targets: \["worker:9101"\]/);
  });

  it('charge les règles par une glob, pour ne jamais refuser de démarrer', () => {
    expect(PROMETHEUS).toMatch(/rule_files:\n {2}- \/etc\/prometheus\/rules\/\*\.yml/);
  });

  it('laisse Alertmanager facultatif', () => {
    expect(PROMETHEUS).toMatch(/^# alerting:$/m);
  });

  it('définit des alertes qui portent toutes délai, gravité et conduite à tenir', () => {
    const alerts = alertBlocks(RULES);
    expect(alerts.length).toBeGreaterThanOrEqual(8);
    for (const { name, body } of alerts) {
      expect(body, `${name}: expr`).toMatch(/\n\s+expr:/);
      expect(body, `${name}: for`).toMatch(/\n\s+for: \d+[mh]/);
      expect(body, `${name}: severity`).toMatch(/severity: (critical|warning)/);
      expect(body, `${name}: summary`).toMatch(/summary: /);
      expect(body, `${name}: description`).toMatch(/description: /);
    }
  });

  it('couvre les pannes que la documentation disait à surveiller', () => {
    for (const alert of [
      'ReviewBackendDown',
      'ReviewWorkerDown',
      'ReviewQueueBacklog',
      'ReviewQueueFailures',
      'ReviewHttpErrorRatio',
    ]) {
      expect(RULES, alert).toContain(`- alert: ${alert}`);
    }
  });

  it('montre les alertes et le worker dans le tableau de bord provisionné', () => {
    const expressions = DASHBOARD.panels.flatMap((p) => p.targets.map((t) => t.expr)).join('\n');
    expect(expressions).toMatch(/ALERTS\{alertstate="firing"\}/);
    expect(expressions).toMatch(/review_worker_jobs_total/);
    expect(expressions).toMatch(/review_worker_job_duration_seconds_bucket/);
    expect(expressions).toMatch(/review_worker_info/);
  });

  it('donne à chaque panneau un identifiant et une position uniques', () => {
    const ids = DASHBOARD.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const panel of DASHBOARD.panels) {
      expect(panel.gridPos.w).toBeGreaterThan(0);
      expect(panel.gridPos.h).toBeGreaterThan(0);
    }
  });
});
