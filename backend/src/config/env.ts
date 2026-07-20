import 'dotenv/config';
import { z } from 'zod';

/**
 * Chargement + validation des variables d'environnement au démarrage.
 * Échoue tôt (fail-fast) si une variable critique manque.
 */
const baseEnvSchema = z.object({
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

  // Email sortant (digest quotidien) — optionnel : sans SMTP_HOST, aucun envoi.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('ReView <no-reply@review.local>'),
  // Clé de chiffrement des secrets stockés (SMTP…). Optionnelle : à défaut, dérivée de
  // JWT_SECRET (SHA-256). En prod, JWT_SECRET est déjà durci (guard ci-dessous).
  APP_ENCRYPTION_KEY: z.string().optional(),
  // 37.G : jeton d'accès à GET /metrics (vide = endpoint réservé au réseau interne).
  METRICS_TOKEN: z.string().optional(),
  // 42.B №66 : Web Push (VAPID). Optionnel — à défaut, une paire est générée et persistée
  // en base (dev). `VAPID_SUBJECT` = mailto: ou URL de contact.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // 37.D : encodeur vidéo du worker (h264_nvenc si GPU NVIDIA exposé au conteneur).
  VIDEO_ENCODER: z.enum(['libx264', 'h264_nvenc']).default('libx264'),
  // 39.A : convertisseur USD→glTF natif (ex. `guc`) préservant matériaux & variantes.
  // Vide = repli sur assimp (support USD expérimental). Voir backend/Dockerfile (ARG GUC_URL).
  USD_GLTF_CONVERTER: z.string().optional(),
  // 37.E : scan antivirus opt-in (clamd INSTREAM) — vide = désactivé.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  // Heure locale (0-23) d'envoi du digest quotidien.
  DIGEST_HOUR: z.coerce.number().min(0).max(23).default(7),
  // URL publique de l'app (liens dans les emails) ; sans elle, liens omis.
  APP_URL: z.string().optional(),
});

/** Un secret est « faible » s'il est trop court ou ressemble à un placeholder. */
const isWeakSecret = (s: string): boolean =>
  s.length < 32 || /change[_-]?me|^changeme$|secret_change/i.test(s);

/**
 * Durcissement production (10.D5) : en `NODE_ENV=production`, refuse de démarrer
 * avec des secrets par défaut/faibles ou une configuration CORS permissive.
 * (En dev/test, ces contrôles sont inactifs pour ne pas gêner le travail local.)
 */
export const envSchema = baseEnvSchema.superRefine((val, ctx) => {
  if (val.NODE_ENV !== 'production') return;
  if (isWeakSecret(val.JWT_SECRET))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET faible/par défaut interdit en production (≥ 32 caractères aléatoires)',
    });
  if (val.CORS_ORIGIN === '*')
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message: "CORS_ORIGIN='*' interdit en production (spécifier la ou les origines exactes)",
    });
  if (val.S3_ACCESS_KEY === 'minioadmin' || val.S3_SECRET_KEY === 'minioadmin')
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['S3_SECRET_KEY'],
      message: 'Identifiants S3/MinIO par défaut (minioadmin) interdits en production',
    });
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
