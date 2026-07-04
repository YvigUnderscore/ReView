import 'dotenv/config';
import { z } from 'zod';

/**
 * Chargement + validation des variables d'environnement au démarrage.
 * Échoue tôt (fail-fast) si une variable critique manque.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Journalisation (pino) : niveau explicite ou dérivé de NODE_ENV si absent.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  // Base de données
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit faire au moins 16 caractères'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Stockage MinIO / S3
  S3_ENDPOINT: z.string().min(1, 'S3_ENDPOINT est requis'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY est requis'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY est requis'),
  S3_BUCKET: z.string().default('review'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // URL publique pour les liens présignés vus par le navigateur (souvent ≠ endpoint interne)
  S3_PUBLIC_ENDPOINT: z.string().optional(),

  // Redis (BullMQ)
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Exception au « pas de console » : ce fail-fast s'exécute AVANT que le logger
  // (qui dépend de `env`) puisse exister. On écrit donc directement sur stderr.
  console.error("❌ Variables d'environnement invalides :");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
