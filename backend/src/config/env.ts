// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  // Inscription libre via POST /api/auth/register. Fermée par défaut : une instance
  // atteignable depuis Internet donnerait sinon un compte authentifié à n'importe qui, et
  // permettrait de créer par avance un compte à l'email d'un collaborateur — que le SSO
  // rapprocherait ensuite de cet email (prise de contrôle à la première connexion OIDC).
  // Les comptes se créent alors depuis l'administration, ou par provisionnement SSO.
  ALLOW_SELF_REGISTRATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
  // 45.D : outillage USD de l'image worker (installé par `--build-arg INSTALL_USD_TOOLS=1`).
  // Blender = conversion USD→GLB (OpenUSD complet) ; Python = analyseur `pxr` (usd-core).
  // Binaires absents → repli automatique guc/assimp, cf. services/ModelConvertService.
  USD_BLENDER_BIN: z.string().default('/opt/blender/blender'),
  USD_PYTHON_BIN: z.string().default('/opt/usdenv/bin/python3'),
  // 46.G : cuisson des variantes USD dans le GLB (bascule instantanée en review). Bornes
  // pour ne pas produire un GLB démesuré sur une scène à nombreuses variantes.
  // 46.P : l'import masqué au prim porteur rend la cuisson d'une option quasi gratuite — le
  // vrai garde-fou est le budget temps (moitié du timeout de conversion), pas ce plafond.
  USD_MAX_BAKED_VARIANTS: z.coerce.number().int().nonnegative().default(512),
  USD_VARIANT_VERTEX_BUDGET: z.coerce.number().int().positive().default(8_000_000),
  // Garde-fou : un convertisseur bloqué immobiliserait un slot de worker indéfiniment.
  MODEL_CONVERT_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  // 45.A : bornes d'extraction des archives 3D (traversée, bombes de décompression).
  ARCHIVE_MAX_ENTRIES: z.coerce.number().int().positive().default(20_000),
  ARCHIVE_MAX_UNCOMPRESSED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024 * 1024),
  ARCHIVE_MAX_COMPRESSION_RATIO: z.coerce.number().int().positive().default(200),
  // 37.E : scan antivirus opt-in (clamd INSTREAM) — vide = désactivé.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  // Heure locale (0-23) d'envoi du digest quotidien.
  DIGEST_HOUR: z.coerce.number().min(0).max(23).default(7),
  // URL publique de l'app (liens dans les emails) ; sans elle, liens omis.
  APP_URL: z.string().optional(),
  // Phase 48 : hôtes ShotGrid joignables hors HTTPS public (liste séparée par des
  // virgules, ex. « localhost:8890 »). Destiné au simulateur de développement : il
  // lève, pour ces hôtes précis, le refus des adresses non publiques. Vide par défaut,
  // et signalé bruyamment au démarrage — un site ShotGrid réel n'en a jamais besoin.
  SHOTGRID_INSECURE_HOSTS: z.string().optional(),
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
  // Si elle est fournie, cette clé protège tous les secrets stockés en base (mot de passe
  // SMTP, secrets de webhooks, secret TOTP de chaque compte). Une valeur faible se
  // retrouverait par force brute : on lui applique la même exigence qu'à JWT_SECRET.
  // Absente, la clé dérive de JWT_SECRET — déjà durci par le contrôle ci-dessus.
  if (val.APP_ENCRYPTION_KEY !== undefined && isWeakSecret(val.APP_ENCRYPTION_KEY))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_ENCRYPTION_KEY'],
      message: 'APP_ENCRYPTION_KEY faible/par défaut interdit en production (≥ 32 caractères aléatoires)',
    });
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Exception au « pas de console » : ce fail-fast s'exécute AVANT que le logger
  // (qui dépend de `env`) puisse exister. On écrit donc directement sur stderr.
  // eslint-disable-next-line no-console
  console.error("❌ Variables d'environnement invalides :");
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
