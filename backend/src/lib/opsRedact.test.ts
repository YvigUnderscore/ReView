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
  it('masque la valeur des secrets connus, où qu’elle apparaisse', () => {
    const log = `DATABASE_URL=postgresql://review:${ENV.POSTGRES_PASSWORD}@postgres:5432/review\njwt=${ENV.JWT_SECRET}`;
    const out = redactSecrets(log, ENV);
    expect(out).not.toContain(ENV.POSTGRES_PASSWORD as string);
    expect(out).not.toContain(ENV.JWT_SECRET as string);
    expect(out).toContain(REDACTED);
  });

  it('masque un mot de passe qui contient des caractères d’expression régulière', () => {
    // C'est la raison d'être du remplacement de chaîne : bâtir une regex sur « p4ss/w+rd. »
    // produirait un motif qui ne correspond pas à ce qu'on cherche — ou qui correspond à tout.
    expect(redactSecrets('mdp=p4ss/w+rd.avec&des$signes fin', ENV)).toBe(`mdp=${REDACTED} fin`);
  });

  it('ne masque pas une valeur trop courte pour être distinctive', () => {
    // Masquer « court » barbouillerait tout journal contenant ce mot.
    expect(redactSecrets('un chemin court et lisible', ENV)).toBe('un chemin court et lisible');
  });

  it('ne fait rien d’une variable vide', () => {
    expect(redactSecrets('rien à cacher', ENV)).toBe('rien à cacher');
  });

  it('masque les motifs autoporteurs, même inconnus de l’environnement', () => {
    // Ce que le journal peut charrier sans qu'on l'ait posé : `docker compose logs backend`
    // remonte ce que l'application a écrit, y compris une trace d'erreur.
    expect(redactSecrets('token rvk_9f3ac81b77d2e0 utilisé', {})).toBe(`token ${REDACTED} utilisé`);
    expect(redactSecrets('Authorization: Bearer eyJhbGciOi.JIUzI1', {})).toBe(`Authorization: ${REDACTED}`);
    expect(redactSecrets('redis://default:hunter22@redis:6379', {})).toBe(
      `redis://default:${REDACTED}@redis:6379`,
    );
  });

  it('laisse intact un journal ordinaire', () => {
    const log = '▶ Dump PostgreSQL (pg_dump -Fc)…\nBACKUP_ID=20260910-030000\nOPS_PHASE=switch';
    expect(redactSecrets(log, ENV)).toBe(log);
  });
});
