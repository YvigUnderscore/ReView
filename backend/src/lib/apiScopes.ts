// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scopes d'API fins (API v1) — helpers PURS, testés.
 *
 * Un token porte une liste de scopes `domaine:action`. Les tokens émis avant cette
 * granularité ne portent que `read`/`write` : `expandScopes` les traduit en scopes
 * fins, de sorte qu'aucun token existant ne se retrouve invalidé. Un token de service
 * (ferme de rendu, bot) n'appartient à personne : il porte son propre rôle effectif et,
 * facultativement, se limite à un projet — voir `lib/apiTokens`.
 */

/** Domaines adressables par un token. Un domaine = une famille de ressources v1. */
export const SCOPE_DOMAINS = [
  'projects',
  'sequences',
  'shots',
  'assets',
  'tasks',
  'versions',
  'media',
  'comments',
  'playlists',
  'events',
  'webhooks',
  'users',
] as const;

export type ScopeDomain = (typeof SCOPE_DOMAINS)[number];

export type ScopeAction = 'read' | 'write';

export type Scope = `${ScopeDomain}:${ScopeAction}` | 'admin';

/** Scopes hérités (tokens créés avant les scopes fins) — conservés pour compatibilité. */
export const LEGACY_SCOPES = ['read', 'write'] as const;

/** Tous les scopes fins attribuables, dans un ordre stable (doc, UI, tests). */
export const ALL_SCOPES: readonly Scope[] = [
  ...SCOPE_DOMAINS.flatMap((d): Scope[] => [`${d}:read`, `${d}:write`]),
  'admin',
];

const SCOPE_SET = new Set<string>(ALL_SCOPES);

/** Chaîne acceptée à la création d'un token : scope fin ou scope hérité. */
export const isGrantableScope = (value: string): boolean =>
  SCOPE_SET.has(value) || (LEGACY_SCOPES as readonly string[]).includes(value);

/**
 * Développe les scopes stockés en scopes fins effectifs.
 * - `read`  → tous les `*:read`
 * - `write` → tous les `*:read` ET `*:write` (une écriture suppose de pouvoir relire)
 * - `admin` → tout, y compris les domaines sensibles
 *
 * Les scopes de gestion (`webhooks:*`, `users:*`) ne sont PAS couverts par le `write`
 * hérité : un token generaliste d'hier ne doit pas se découvrir le droit de créer des
 * webhooks ou de lire l'annuaire du jour au lendemain.
 */
const LEGACY_EXCLUDED: readonly ScopeDomain[] = ['webhooks', 'users'];

export function expandScopes(stored: readonly string[]): Set<Scope> {
  const out = new Set<Scope>();
  if (stored.includes('admin')) {
    for (const s of ALL_SCOPES) out.add(s);
    return out;
  }
  const legacyDomains = SCOPE_DOMAINS.filter((d) => !LEGACY_EXCLUDED.includes(d));
  if (stored.includes('read') || stored.includes('write')) {
    for (const d of legacyDomains) out.add(`${d}:read`);
  }
  if (stored.includes('write')) {
    for (const d of legacyDomains) out.add(`${d}:write`);
  }
  for (const s of stored) {
    if (SCOPE_SET.has(s)) out.add(s as Scope);
  }
  // Une écriture accordée finement implique la lecture du même domaine.
  for (const s of [...out]) {
    const [domain, action] = s.split(':');
    if (action === 'write' && domain) out.add(`${domain as ScopeDomain}:read`);
  }
  return out;
}

/** Le token couvre-t-il le scope demandé ? `admin` couvre tout. */
export function hasScope(stored: readonly string[], required: Scope): boolean {
  const granted = expandScopes(stored);
  return granted.has('admin') || granted.has(required);
}

/** Scope requis par défaut pour une méthode HTTP sur un domaine donné. */
export const scopeFor = (domain: ScopeDomain, method: string): Scope =>
  `${domain}:${['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'read' : 'write'}`;
