// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { envSchema } from './env';

// Base valide de production (secrets forts, CORS strict, identifiants S3 réels).
const prodBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/review',
  JWT_SECRET: 'x'.repeat(40),
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'AKIAREALKEY',
  S3_SECRET_KEY: 'realsecretvalue',
  CORS_ORIGIN: 'https://review.example.com',
};

const issuePaths = (input: Record<string, unknown>) => {
  const r = envSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('env — durcissement production (10.D5)', () => {
  it('accepte une configuration de production correcte', () => {
    expect(envSchema.safeParse(prodBase).success).toBe(true);
  });

  it('refuse un JWT_SECRET par défaut/faible en production', () => {
    expect(issuePaths({ ...prodBase, JWT_SECRET: 'change_me_with_a_long_random_secret_min_32c' })).toContain(
      'JWT_SECRET',
    );
    expect(issuePaths({ ...prodBase, JWT_SECRET: 'court' })).toContain('JWT_SECRET');
  });

  it("refuse CORS_ORIGIN='*' en production", () => {
    expect(issuePaths({ ...prodBase, CORS_ORIGIN: '*' })).toContain('CORS_ORIGIN');
  });

  it('refuse les identifiants MinIO par défaut en production', () => {
    expect(issuePaths({ ...prodBase, S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin' })).toContain(
      'S3_SECRET_KEY',
    );
  });

  it('en développement, les secrets faibles sont tolérés (garde-fous inactifs)', () => {
    // ≥ 16 (min de base) mais « faible » (contient change_me) : accepté hors production.
    const dev = { ...prodBase, NODE_ENV: 'development', JWT_SECRET: 'change_me_devkey', CORS_ORIGIN: '*' };
    expect(envSchema.safeParse(dev).success).toBe(true);
  });
});

/**
 * TRUST_PROXY — la valeur passée à `app.set('trust proxy', …)` (backend/src/app.ts).
 *
 * Elle décide si `req.ip` — clé de TOUS les limiteurs et adresse écrite au journal d'audit —
 * se lit dans la socket ou dans `X-Forwarded-For`, un en-tête que l'appelant fournit. Codée
 * en dur à 1, elle rendait chaque limiteur contournable d'un en-tête dès que le backend était
 * joignable sans proxy devant : un quota neuf par adresse inventée.
 *
 * Les deux derniers cas montent un vrai serveur Express : c'est le comportement observable
 * qu'on verrouille, pas la valeur de la variable.
 */
const ipApp = (trustProxy: number) => {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
};

const observedIp = async (trustProxy: number, forwardedFor: string): Promise<string> => {
  const res = await request(ipApp(trustProxy)).get('/ip').set('X-Forwarded-For', forwardedFor);
  return (res.body as { ip: string }).ip;
};

describe('env — TRUST_PROXY (A3-01 / A5-01)', () => {
  it("ne fait confiance à aucun proxy tant qu'on ne l'a pas demandé", () => {
    expect(envSchema.parse(prodBase).TRUST_PROXY).toBe(0);
    // Une variable vide (compose passe `${TRUST_PROXY:-}` quand .env est muet) retombe sur
    // le comportement prudent, jamais sur « fais confiance ».
    expect(envSchema.parse({ ...prodBase, TRUST_PROXY: '' }).TRUST_PROXY).toBe(0);
  });

  it('accepte un nombre de sauts borné, et rien d’autre', () => {
    expect(envSchema.parse({ ...prodBase, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(issuePaths({ ...prodBase, TRUST_PROXY: 'true' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '-1' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '9' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '1.5' })).toContain('TRUST_PROXY');
  });

  it("par défaut, un X-Forwarded-For forgé ne décide plus de l'adresse du client", async () => {
    const ip = await observedIp(envSchema.parse(prodBase).TRUST_PROXY, '203.0.113.7');
    expect(ip).not.toBe('203.0.113.7');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('à 1 — un seul proxy devant —, req.ip est la dernière entrée, celle que le proxy a ajoutée', async () => {
    // Ce que produit `$proxy_add_x_forwarded_for` de nginx : la valeur du client d'abord,
    // l'adresse réelle appendue ensuite. Seule la dernière est digne de foi.
    const ip = await observedIp(
      envSchema.parse({ ...prodBase, TRUST_PROXY: '1' }).TRUST_PROXY,
      '203.0.113.7, 10.0.0.9',
    );
    expect(ip).toBe('10.0.0.9');
  });
});
