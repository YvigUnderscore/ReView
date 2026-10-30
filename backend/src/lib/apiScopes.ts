// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fine-grained API scopes (API v1): pure helpers, tested.
 *
 * A token carries a list of `domain:action` scopes. Tokens issued before this granularity only carry
 * `read`/`write`: `expandScopes` translates them into fine scopes, so no existing token is
 * invalidated. A service token (render farm, bot) belongs to nobody: it carries its own effective
 * role and may optionally be limited to one project — see `lib/apiTokens`.
 *
 * **The catalogue only describes what is really guarded.** Nine scopes declared here were required
 * by no route: `playlists:*`, `webhooks:*`, `users:*`, `projects:write` and `events:write`. A scope
 * that protects nothing is worse than none: it is ticked when creating a token, read in the docs,
 * and suggests a scoping that does not exist. They have been removed; the families concerned are
 * simply not exposed by `/api/v1` (webhooks and the directory live on the internal API, which
 * `apiTokenSurface` closes to tokens).
 */

export type ScopeAction = 'read' | 'write';

/**
 * Addressable domains, and for each the actions a v1 route really requires.
 *
 * Adding an action here without placing it on a route would put it back in the same state: the table
 * is the declaration, `requireScope` is the usage, and both must move together.
 */
const DOMAIN_ACTIONS = {
  // Read-only: creating a project does not belong to the integration API.
  projects: ['read'],
  // Episode level is readable; it is composed from the interface. Writing what an episode carries
  // (leads, brief) goes through `sequences:write`, the level it groups under, rather than declaring
  // a write action that no route would require.
  episodes: ['read'],
  sequences: ['read', 'write'],
  shots: ['read', 'write'],
  assets: ['read', 'write'],
  tasks: ['read', 'write'],
  versions: ['read', 'write'],
  media: ['read', 'write'],
  comments: ['read', 'write'],
  // The event log is read; it writes itself.
  events: ['read'],
} as const satisfies Readonly<Record<string, readonly ScopeAction[]>>;

export type ScopeDomain = keyof typeof DOMAIN_ACTIONS;

/** Domains addressable by a token. One domain = one v1 resource family. */
export const SCOPE_DOMAINS = Object.keys(DOMAIN_ACTIONS) as readonly ScopeDomain[];

/** Exactly the pairs declared above; `projects:write` does not exist. */
export type Scope =
  { [D in ScopeDomain]: `${D}:${(typeof DOMAIN_ACTIONS)[D][number]}` }[ScopeDomain] | 'admin';

/** Legacy scopes (tokens created before fine scopes), kept for compatibility. */
export const LEGACY_SCOPES = ['read', 'write'] as const;

/** All assignable fine scopes, in a stable order (docs, UI, tests). */
export const ALL_SCOPES: readonly Scope[] = [
  ...SCOPE_DOMAINS.flatMap((d): Scope[] => DOMAIN_ACTIONS[d].map((a) => `${d}:${a}` as Scope)),
  'admin',
];

const SCOPE_SET = new Set<string>(ALL_SCOPES);

/** String accepted when creating a token: a fine scope or a legacy scope. */
export const isGrantableScope = (value: string): boolean =>
  SCOPE_SET.has(value) || (LEGACY_SCOPES as readonly string[]).includes(value);

/**
 * Expands stored scopes into effective fine scopes.
 * - `read`  → all `*:read`
 * - `write` → all `*:read` AND the declared `*:write` (a write implies reading)
 * - `admin` → everything
 *
 * A stored scope no longer in the catalogue (yesterday's `playlists:read`) is ignored like any
 * unknown string: the token stays valid, and loses no power since no route ever checked that scope.
 */
export function expandScopes(stored: readonly string[]): Set<Scope> {
  const out = new Set<Scope>();
  if (stored.includes('admin')) {
    for (const s of ALL_SCOPES) out.add(s);
    return out;
  }
  if (stored.includes('read') || stored.includes('write')) {
    for (const d of SCOPE_DOMAINS) out.add(`${d}:read` as Scope);
  }
  if (stored.includes('write')) {
    for (const s of ALL_SCOPES) if (s.endsWith(':write')) out.add(s);
  }
  for (const s of stored) {
    if (SCOPE_SET.has(s)) out.add(s as Scope);
  }
  // A finely granted write implies reading the same domain.
  for (const s of [...out]) {
    const [domain, action] = s.split(':');
    if (action === 'write' && domain) out.add(`${domain}:read` as Scope);
  }
  return out;
}

/** Does the token cover the requested scope? `admin` covers everything. */
export function hasScope(stored: readonly string[], required: Scope): boolean {
  const granted = expandScopes(stored);
  return granted.has('admin') || granted.has(required);
}
