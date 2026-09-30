// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Caviardage des secrets dans un journal d'exploitation, avant qu'il n'atteigne un
 * navigateur.
 *
 * Le journal d'une mise à jour contient ce que `docker compose` et `scripts/update.sh` ont
 * écrit — y compris, en cas d'échec, `docker compose logs --tail=50 backend`, dont le
 * contenu n'est pas de nous : une trace d'erreur peut charrier une URL de connexion
 * complète, mot de passe compris. L'écran est réservé aux admins, mais une capture d'écran
 * dans un ticket de support, elle, ne l'est plus.
 *
 * **Remplacement de chaîne, jamais de regex construite.** Un mot de passe contient
 * volontiers `/`, `+`, `$` ou `.` : bâtir une expression régulière à partir de sa valeur
 * produirait au mieux un motif qui ne correspond pas, au pire un motif qui correspond à
 * tout. C'est aussi pourquoi le caviardage se fait ici, en TypeScript, et jamais par un
 * `sed` dans le script.
 */

/** Variables dont la VALEUR ne doit jamais s'afficher. */
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
 * Une valeur trop courte n'est pas caviardable : masquer « dev » remplacerait le mot dans
 * tout le journal. En dessous de ce seuil, on préfère ne rien masquer que tout barbouiller.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Motifs reconnaissables en eux-mêmes, indépendants de l'environnement : jetons d'API
 * ReView (cf. `ApiTokenService`) et en-têtes d'autorisation. Remplacés en bloc.
 */
const OPAQUE_PATTERNS: RegExp[] = [
  /\brvk_[A-Za-z0-9_-]{8,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * URL de connexion avec identifiants (`postgresql://review:motdepasse@postgres:5432/…`).
 * Traité à part des précédents : lui seul a un groupe de capture, et une fonction de
 * remplacement partagée recevrait alors le DÉCALAGE en deuxième argument pour les motifs
 * qui n'en ont pas — un nombre, donc une valeur vraie, donc un caviardage mal formé.
 */
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi;

/**
 * Remplace dans `text` toute valeur secrète connue de l'environnement, puis les motifs
 * autoporteurs. L'environnement est passé en paramètre : le test n'a rien à contaminer.
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
