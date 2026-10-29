// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Redaction of secrets in an operations log, before it reaches a browser.
 *
 * The log of an update contains what `docker compose` and `scripts/update.sh` wrote — including, on failure,
 * `docker compose logs --tail=50 backend`, whose content is not ours: an error trace may carry a complete connection URL,
 * password included. The screen is reserved for admins, but a screenshot in a support ticket is no longer.
 *
 * **String replacement, never a built regex.** A password readily contains `/`, `+`, `$` or `.`: building a regular
 * expression from its value would at best produce a pattern that does not match, at worst a pattern that matches
 * everything. This is also why redaction is done here, in TypeScript, and never by a `sed` in the script.
 */

/** Variables whose VALUE must never be displayed. */
const SECRET_VARS = [
  'JWT_SECRET',
  'APP_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'S3_SECRET_KEY',
  'METRICS_TOKEN',
  'GRAFANA_ADMIN_PASSWORD',
  'RELEASE_GITHUB_TOKEN',
  'SMTP_PASS',
] as const;

export const REDACTED = '••••••••';

/**
 * A value too short to be redacted: masking "dev" would replace the word throughout the whole log. Below this threshold,
 * we prefer to mask nothing rather than smudge everything.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Patterns recognisable in themselves, independent of the environment: ReView API tokens (cf. `ApiTokenService`) and
 * authorisation headers. Replaced wholesale.
 */
const OPAQUE_PATTERNS: RegExp[] = [
  /\brvk_[A-Za-z0-9_-]{8,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * Connection URL with credentials (`postgresql://review:motdepasse@postgres:5432/…`).
 * Handled apart from the previous ones: it alone has a capture group, and a shared replacement function would then receive
 * the OFFSET as its second argument for the patterns that have none — a number, hence a truthy value, hence a malformed redaction.
 */
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi;

/**
 * Replaces in `text` any secret value known from the environment, then the self-standing patterns. The environment is
 * passed as a parameter: the test has nothing to contaminate.
 */
export function redactSecrets(text: string, environment: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of SECRET_VARS) {
    const value = environment[name];
    if (!value || value.length < MIN_SECRET_LENGTH) continue;
    out = out.split(value).join(REDACTED);
  }
  for (const pattern of OPAQUE_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(CREDENTIAL_URL, (_match, scheme: string) => `${scheme}:${REDACTED}@`);
  return out;
}
