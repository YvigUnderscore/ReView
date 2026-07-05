import { describe, it, expect } from 'vitest';
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
