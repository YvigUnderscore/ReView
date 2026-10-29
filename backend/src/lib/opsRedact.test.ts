// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets } from './opsRedact';

const ENV = {
  JWT_SECRET: 'a7f3c9e1b5d2846019fbe3ac57d0912f',
  POSTGRES_PASSWORD: 'p4ss/w+rd.avec&des$signes',
  SMTP_PASS: 'court',
  RELEASE_GITHUB_TOKEN: '',
} as unknown as NodeJS.ProcessEnv;

describe('redactSecrets', () => {
  it('masks the value of known secrets, wherever it appears', () => {
    const log = `DATABASE_URL=postgresql://review:${ENV.POSTGRES_PASSWORD}@postgres:5432/review\njwt=${ENV.JWT_SECRET}`;
    const out = redactSecrets(log, ENV);
    expect(out).not.toContain(ENV.POSTGRES_PASSWORD as string);
    expect(out).not.toContain(ENV.JWT_SECRET as string);
    expect(out).toContain(REDACTED);
  });

  it('masks a password containing regular-expression characters', () => {
    // This is the raison d'être of the string replacement: building a regex from "p4ss/w+rd." would produce a pattern
    // that does not match what we look for — or that matches everything.
    expect(redactSecrets('mdp=p4ss/w+rd.avec&des$signes fin', ENV)).toBe(`mdp=${REDACTED} fin`);
  });

  it('does not mask a value too short to be distinctive', () => {
    // Masking "court" would smudge every log containing that word.
    expect(redactSecrets('un chemin court et lisible', ENV)).toBe('un chemin court et lisible');
  });

  it('does nothing with an empty variable', () => {
    expect(redactSecrets('rien à cacher', ENV)).toBe('rien à cacher');
  });

  it('masks self-standing patterns, even those unknown to the environment', () => {
    // What the log can carry without us having set it: `docker compose logs backend` brings back what the application
    // wrote, including an error trace.
    expect(redactSecrets('token rvk_9f3ac81b77d2e0 utilisé', {})).toBe(`token ${REDACTED} utilisé`);
    expect(redactSecrets('Authorization: Bearer eyJhbGciOi.JIUzI1', {})).toBe(`Authorization: ${REDACTED}`);
    expect(redactSecrets('redis://default:hunter22@redis:6379', {})).toBe(
      `redis://default:${REDACTED}@redis:6379`,
    );
  });

  it('leaves an ordinary log intact', () => {
    const log = '▶ Dump PostgreSQL (pg_dump -Fc)…\nBACKUP_ID=20260910-030000\nOPS_PHASE=switch';
    expect(redactSecrets(log, ENV)).toBe(log);
  });
});
