// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Guardrails on continuous integration.
 *
 * The `scripts/validate.sh` suite is a protected principle: CI must replay it as it is, never a subset.
 * These checks lock down what a YAML file cannot say about itself — that the command is neither truncated
 * nor neutralised by a `|| true`, that both packages are indeed installed (the notice freshness check reads
 * `node_modules`), that the Node version does not drift from that of the runtime images, and that `.github/`
 * is not re-ignored (the default flagged by the audit of 2026-08-21: a workflow present but never committed).
 *
 * Deliberately textual reading: no YAML parser is declared among the repository's dependencies, and adding
 * one for a configuration test would be disproportionate.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Strips the comment lines: we check the configuration, not what it says about itself. */
export function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

const WORKFLOW = stripComments(read('.github/workflows/validate.yml'));

/**
 * Isolates the block of a job: from its key (two spaces of indentation) up to the next key at
 * the same level, or the end of the file.
 */
export function jobBlock(text, id) {
  const start = text.indexOf(`\n  ${id}:\n`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Node major version required by an image (`FROM node:22-slim` → `22`). */
export function dockerNodeMajor(dockerfile) {
  return dockerfile.match(/^FROM node:(\d+)/m)?.[1] ?? null;
}

describe('validation workflow', () => {
  it('triggers on push and pull request', () => {
    expect(WORKFLOW).toMatch(/^on:$/m);
    expect(WORKFLOW).toMatch(/^ {2}push:$/m);
    expect(WORKFLOW).toMatch(/^ {2}pull_request:$/m);
  });

  it('only asks to read the repository', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('defines the two expected jobs', () => {
    expect(jobBlock(WORKFLOW, 'validate')).not.toBeNull();
    expect(jobBlock(WORKFLOW, 'integration')).not.toBeNull();
  });

  it('runs the whole suite, never a subset', () => {
    const invocations = WORKFLOW.split('\n').filter((line) => line.includes('scripts/validate.sh'));
    // Three calls: the suite alone, plus the integration tests, plus the Playwright E2E path.
    expect(invocations).toHaveLength(3);
    for (const line of invocations) {
      expect(line).toMatch(/^ +run: bash scripts\/validate\.sh( --with-integration| --with-e2e)?$/);
    }
    expect(jobBlock(WORKFLOW, 'validate')).toMatch(/run: bash scripts\/validate\.sh$/m);
    expect(jobBlock(WORKFLOW, 'integration')).toMatch(/run: bash scripts\/validate\.sh --with-integration$/m);
  });

  it('makes the unit job blocking', () => {
    expect(jobBlock(WORKFLOW, 'validate')).not.toMatch(/continue-on-error/);
  });

  it('installs both packages from the lockfiles', () => {
    for (const id of ['validate', 'integration']) {
      const block = jobBlock(WORKFLOW, id);
      expect(block).toMatch(/run: npm ci\n +working-directory: backend/);
      expect(block).toMatch(/run: npm ci\n +working-directory: frontend/);
      // `npm install` would rewrite the lockfile: the freshness of the notices would mean nothing.
      expect(block).not.toMatch(/run: npm install/);
    }
  });

  it('provides Postgres, Redis and MinIO with their counterpart on the job side', () => {
    const block = jobBlock(WORKFLOW, 'integration');
    expect(block).toMatch(/image: postgres:/);
    expect(block).toMatch(/image: redis:/);
    expect(block).toMatch(/npx prisma migrate deploy/);
  });

  it('tests the MinIO that studios run, pinned as in docker-compose.yml', () => {
    // The job pulled `minio/minio:latest`: the day this repository left Docker Hub, it fell over
    // on its own, while the compose file pointed to a different version from the one tested.
    const pinned = /^ {4}image: (\S+):\$\{MINIO_VERSION:-([^}]+)\}$/m.exec(read('docker-compose.yml'));
    expect(pinned).not.toBeNull();
    const block = jobBlock(WORKFLOW, 'integration');
    expect(block).toContain(`${pinned[1]}:${pinned[2]} server /data`);
    // The bucket is created with the `mc` of the server image, not with a second image.
    expect(block).toMatch(/docker exec [^\n]*\\\n +minio mc mb /);
  });

  it('follows the Node version of the runtime images', () => {
    const backend = dockerNodeMajor(read('backend/Dockerfile'));
    const frontend = dockerNodeMajor(read('frontend/Dockerfile'));
    expect(backend).toBe(frontend);
    expect(WORKFLOW).toMatch(new RegExp(`^ +NODE_VERSION: '${backend}'$`, 'm'));
  });
});

describe('public repository tooling', () => {
  it('leaves .github committable', () => {
    const ignored = read('.gitignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(ignored.some((line) => line.replace(/^\/+|\/+$/g, '') === '.github')).toBe(false);
  });

  it('reminds the validation suite and the CLA in the pull request template', () => {
    const template = read('.github/pull_request_template.md');
    expect(template).toMatch(/scripts\/validate\.sh/);
    expect(template).toMatch(/CLA\.md/);
  });

  it('routes vulnerabilities to the security policy rather than to a public ticket', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug_report.yml')).toMatch(/SECURITY\.md/);
    expect(read('SECURITY.md')).toMatch(/Report a vulnerability/);
  });
});
