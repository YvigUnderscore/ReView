// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dotenv/config';
import { z } from 'zod';

/**
 * Loads and validates environment variables at startup.
 * Fails fast if a critical variable is missing.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Logging (pino): explicit level, or derived from NODE_ENV when absent.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit faire au moins 16 caractères'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  // Open sign-up via POST /api/auth/register. Closed by default: an instance reachable from
  // the Internet would otherwise give an authenticated account to anyone, and would let
  // someone pre-create an account for a colleague's email, which SSO would later match to that
  // email (account takeover at first OIDC login). Accounts are then created from the admin
  // screen or via SSO provisioning.
  ALLOW_SELF_REGISTRATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // MinIO / S3 storage
  S3_ENDPOINT: z.string().min(1, 'S3_ENDPOINT est requis'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY est requis'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY est requis'),
  S3_BUCKET: z.string().default('review'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Public URL for presigned links seen by the browser (often different from the internal endpoint)
  S3_PUBLIC_ENDPOINT: z.string().optional(),

  // Redis (BullMQ)
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Number of trusted proxies in front of the API (`app.set('trust proxy', ...)`).
  //
  // Zero by default, and that is the point: with any other value, Express reads `req.ip` from
  // `X-Forwarded-For`, a header the CALLER supplies. As the backend port is reachable directly
  // once published, a hard-coded value would make every per-IP limiter bypassable with a header
  // (a fresh quota per made-up address) and let an attacker choose the address written to the
  // audit log.
  // At 0, `req.ip` is the socket address again: wrong behind a proxy, but never forgeable. Set 1
  // when, and only when, the nginx of `nginx/nginx.conf` (or an equivalent proxy rewriting
  // `X-Forwarded-For`) is the only entry path.
  TRUST_PROXY: z.coerce
    .number({ error: 'TRUST_PROXY doit être un nombre de sauts (0 = aucun proxy)' })
    .int()
    .min(0)
    .max(4)
    .default(0),

  // Outgoing email (daily digest): optional. Without SMTP_HOST, nothing is sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('ReView <no-reply@review.local>'),
  // Encryption key for stored secrets (SMTP...). Optional: otherwise derived from
  // JWT_SECRET (SHA-256). In production, JWT_SECRET is already hardened (guard below).
  APP_ENCRYPTION_KEY: z.string().optional(),
  // 37.G: access token for GET /metrics (empty = endpoint reserved for the internal network).
  METRICS_TOKEN: z.string().optional(),
  // 42.B #66: Web Push (VAPID). Optional: otherwise a pair is generated and persisted in the
  // database (dev). `VAPID_SUBJECT` = mailto: or a contact URL.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // 37.D: worker video encoder (h264_nvenc if an NVIDIA GPU is exposed to the container).
  VIDEO_ENCODER: z.enum(['libx264', 'h264_nvenc']).default('libx264'),
  // 39.A: native USD-to-glTF converter (e.g. `guc`) preserving materials and variants.
  // Empty = fall back to assimp (experimental USD support). See backend/Dockerfile (ARG GUC_URL).
  USD_GLTF_CONVERTER: z.string().optional(),
  // 45.D: USD tooling of the worker image (installed by `--build-arg INSTALL_USD_TOOLS=1`).
  // Blender = USD-to-GLB conversion (full OpenUSD); Python = `pxr` parser (usd-core).
  // Missing binaries fall back automatically to guc/assimp, see services/ModelConvertService.
  USD_BLENDER_BIN: z.string().default('/opt/blender/blender'),
  USD_PYTHON_BIN: z.string().default('/opt/usdenv/bin/python3'),
  // 46.G: baking USD variants into the GLB (instant switching in review). Bounds so that a
  // GLB is not produced at unreasonable size for a scene with many variants.
  // 46.P: importing hidden under the carrying prim makes baking an option almost free; the real
  // safeguard is the time budget (half the conversion timeout), not this cap.
  USD_MAX_BAKED_VARIANTS: z.coerce.number().int().nonnegative().default(512),
  USD_VARIANT_VERTEX_BUDGET: z.coerce.number().int().positive().default(8_000_000),
  // Safeguard: a blocked converter would hold a worker slot indefinitely.
  MODEL_CONVERT_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  // 45.A: extraction limits for 3D archives (path traversal, decompression bombs).
  ARCHIVE_MAX_ENTRIES: z.coerce.number().int().positive().default(20_000),
  ARCHIVE_MAX_UNCOMPRESSED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024 * 1024),
  ARCHIVE_MAX_COMPRESSION_RATIO: z.coerce.number().int().positive().default(200),
  // 37.E: opt-in antivirus scan (clamd INSTREAM). Empty = disabled.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  // Local hour (0-23) at which the daily digest is sent.
  DIGEST_HOUR: z.coerce.number().min(0).max(23).default(7),
  // Public app URL (links in emails); without it, links are omitted.
  APP_URL: z.string().optional(),
  // Phase 48: ShotGrid hosts reachable without public HTTPS (comma-separated list,
  // e.g. "localhost:8890"). Meant for the development simulator: for these exact hosts it
  // lifts the refusal of non-public addresses. Empty by default, and reported loudly at
  // startup: a real ShotGrid site never needs it.
  SHOTGRID_INSECURE_HOSTS: z.string().optional(),
  // Phase 49: "Updates & backups" screen. Repository whose published releases are offered:
  // a studio running its own fork follows its own repository.
  RELEASE_REPO: z.string().default('YvigUnderscore/ReView'),
  // Switch for an instance without outbound access. The screen stays useful: it simply stops
  // asking GitHub, and says so instead of failing without explanation.
  RELEASE_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Optional GitHub token: raises the API quota (60 calls/h per IP without a token), and
  // allows reading a private repository for a studio that has not published its fork.
  RELEASE_GITHUB_TOKEN: z.string().optional(),
  // Path, INSIDE the container, of the folder that `scripts/backup.sh` fills on the host.
  // Absent: the screen says it sees no backup, rather than inventing one.
  BACKUPS_DIR: z.string().optional(),
  // Order queue of the operations agent. Two DISTINCT paths rather than one: the backend writes
  // to the queue and reads state only read-only (the mount enforces it). Without this
  // asymmetry, a compromised backend (it runs as root and handles user files) could pre-place a
  // link in the state and make the docker daemon write anywhere on the host. Absent: execution
  // is switched off, and the screen says so.
  OPS_QUEUE_DIR: z.string().optional(),
  OPS_STATE_DIR: z.string().optional(),
  // Beyond this silence, the agent is considered dead, and an operation "in progress" for
  // longer becomes "unknown outcome" rather than spinning on screen forever.
  OPS_AGENT_STALE_SEC: z.coerce.number().int().positive().default(90),
  // Expiry of an order not picked up: an update triggered an hour after the click is a
  // surprise, not a service.
  OPS_ORDER_TTL_SEC: z.coerce.number().int().positive().default(900),
});

/** A secret is "weak" if it is too short or looks like a placeholder. */
const isWeakSecret = (s: string): boolean =>
  s.length < 32 || /change[_-]?me|^changeme$|secret_change/i.test(s);

/**
 * Production hardening (10.D5): with `NODE_ENV=production`, refuses to start with default or
 * weak secrets, or with a permissive CORS configuration.
 * (In dev/test these checks are inactive so as not to hinder local work.)
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
  // If provided, this key protects all secrets stored in the database (SMTP password, webhook
  // secrets, each account's TOTP secret). A weak value could be brute-forced, so it is held to
  // the same requirement as JWT_SECRET.
  // If absent, the key is derived from JWT_SECRET, already hardened by the check above.
  if (val.APP_ENCRYPTION_KEY !== undefined && isWeakSecret(val.APP_ENCRYPTION_KEY))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_ENCRYPTION_KEY'],
      message: 'APP_ENCRYPTION_KEY faible/par défaut interdit en production (≥ 32 caractères aléatoires)',
    });
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Exception to "no console": this fail-fast runs BEFORE the logger (which depends on `env`)
  // can exist. So we write directly to stderr.
  // eslint-disable-next-line no-console
  console.error("❌ Variables d'environnement invalides :");
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
