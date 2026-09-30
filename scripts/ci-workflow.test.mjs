// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Garde-fous sur l'intégration continue.
 *
 * La suite `scripts/validate.sh` est un principe protégé : la CI doit la rejouer telle
 * quelle, jamais un sous-ensemble. Ces contrôles verrouillent ce qu'un fichier YAML ne sait
 * pas dire de lui-même — que la commande n'est ni tronquée, ni neutralisée par un `|| true`,
 * que les deux paquets sont bien installés (le contrôle de fraîcheur des notices lit
 * `node_modules`), que la version de Node ne dérive pas de celle des images d'exécution,
 * et que `.github/` n'est pas ré-ignoré (le défaut relevé par l'audit du 2026-08-21 :
 * un workflow présent mais jamais commité).
 *
 * Lecture textuelle assumée : aucun analyseur YAML n'est déclaré dans les dépendances du
 * dépôt, et une dépendance nouvelle pour un test de configuration serait disproportionnée.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Retire les lignes de commentaire : on contrôle la configuration, pas ce qu'elle raconte. */
export function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

const WORKFLOW = stripComments(read('.github/workflows/validate.yml'));

/**
 * Isole le bloc d'un job : de sa clé (deux espaces d'indentation) jusqu'à la clé de même
 * niveau qui suit, ou la fin du fichier.
 */
export function jobBlock(text, id) {
  const start = text.indexOf(`\n  ${id}:\n`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Majeure de Node exigée par une image (`FROM node:22-slim` → `22`). */
export function dockerNodeMajor(dockerfile) {
  return dockerfile.match(/^FROM node:(\d+)/m)?.[1] ?? null;
}

describe('workflow de validation', () => {
  it('se déclenche sur push et pull request', () => {
    expect(WORKFLOW).toMatch(/^on:$/m);
    expect(WORKFLOW).toMatch(/^ {2}push:$/m);
    expect(WORKFLOW).toMatch(/^ {2}pull_request:$/m);
  });

  it('ne demande que la lecture du dépôt', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('définit les deux jobs attendus', () => {
    expect(jobBlock(WORKFLOW, 'validate')).not.toBeNull();
    expect(jobBlock(WORKFLOW, 'integration')).not.toBeNull();
  });

  it('joue la suite entière, jamais un sous-ensemble', () => {
    const invocations = WORKFLOW.split('\n').filter((line) => line.includes('scripts/validate.sh'));
    // Deux appels : la suite seule, puis la suite plus les tests d'intégration.
    expect(invocations).toHaveLength(2);
    for (const line of invocations) {
      expect(line).toMatch(/^ +run: bash scripts\/validate\.sh( --with-integration)?$/);
    }
    expect(jobBlock(WORKFLOW, 'validate')).toMatch(/run: bash scripts\/validate\.sh$/m);
    expect(jobBlock(WORKFLOW, 'integration')).toMatch(/run: bash scripts\/validate\.sh --with-integration$/m);
  });

  it('rend le job unitaire bloquant', () => {
    expect(jobBlock(WORKFLOW, 'validate')).not.toMatch(/continue-on-error/);
  });

  it('installe les deux paquets à partir des lockfiles', () => {
    for (const id of ['validate', 'integration']) {
      const block = jobBlock(WORKFLOW, id);
      expect(block).toMatch(/run: npm ci\n +working-directory: backend/);
      expect(block).toMatch(/run: npm ci\n +working-directory: frontend/);
      // `npm install` réécrirait le lockfile : la fraîcheur des notices ne voudrait plus rien dire.
      expect(block).not.toMatch(/run: npm install/);
    }
  });

  it('fournit à Postgres, Redis et MinIO leur pendant côté job', () => {
    const block = jobBlock(WORKFLOW, 'integration');
    expect(block).toMatch(/image: postgres:/);
    expect(block).toMatch(/image: redis:/);
    expect(block).toMatch(/minio\/minio:\w+ server \/data/);
    expect(block).toMatch(/npx prisma migrate deploy/);
  });

  it('suit la version de Node des images d’exécution', () => {
    const backend = dockerNodeMajor(read('backend/Dockerfile'));
    const frontend = dockerNodeMajor(read('frontend/Dockerfile'));
    expect(backend).toBe(frontend);
    expect(WORKFLOW).toMatch(new RegExp(`^ +NODE_VERSION: '${backend}'$`, 'm'));
  });
});

describe('outillage de dépôt public', () => {
  it('laisse .github commitable', () => {
    const ignored = read('.gitignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(ignored.some((line) => line.replace(/^\/+|\/+$/g, '') === '.github')).toBe(false);
  });

  it('rappelle la suite de validation et le CLA dans le gabarit de pull request', () => {
    const template = read('.github/pull_request_template.md');
    expect(template).toMatch(/scripts\/validate\.sh/);
    expect(template).toMatch(/CLA\.md/);
  });

  it('route les failles vers la politique de sécurité plutôt que vers un ticket public', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug_report.yml')).toMatch(/SECURITY\.md/);
    expect(read('SECURITY.md')).toMatch(/Report a vulnerability/);
  });
});
