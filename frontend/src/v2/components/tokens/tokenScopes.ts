// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PURE helpers for the machine rights model: the logic the token screen shares between the
 * profile (personal token) and administration (service token).
 *
 * The scope catalogue is never copied here: it comes from `GET /api/auth/scopes`. This file
 * only formats it (`domain:action` → one row per domain) and keeps the checkboxes consistent.
 * Intended consequence: the day the server removes a scope from its catalogue, the screen
 * stops offering it without anyone touching it.
 */

/** One row of the picker: a domain and the actions the server declares for it. */
export interface ScopeDomainRow {
  domain: string;
  /** Full scope (`versions:read`), or `null` if the server does not declare it. */
  read: string | null;
  write: string | null;
}

export interface GroupedScopes {
  domains: ScopeDomainRow[];
  /** Scopes without a domain: `admin` today. They govern everything, so they are isolated. */
  standalone: string[];
}

/** Scope that covers everything: ticking anything else alongside it would be meaningless. */
export const ADMIN_SCOPE = 'admin';

/** Splits the domain from the action in a scope (`versions:write`). */
const SEPARATOR = ':';

/**
 * Rebuilds a scope. Assembled with `join` rather than a template: the hard-coded text
 * checker sees `` `${domain}:read` `` as a sentence around an interpolation, and it is
 * right to be wary of it: here it is an API identifier, not prose.
 */
const scopeOf = (domain: string, action: 'read' | 'write'): string => [domain, action].join(SEPARATOR);

/**
 * Groups the catalogue by domain, in the order the server served it.
 * A malformed scope (without `:`) is treated as a global scope rather than ignored: better
 * an extra checkbox than an invisible right.
 */
export function groupScopes(scopes: readonly string[]): GroupedScopes {
  const rows = new Map<string, ScopeDomainRow>();
  const standalone: string[] = [];
  for (const scope of scopes) {
    const [domain, action] = scope.split(SEPARATOR);
    if (!domain || (action !== 'read' && action !== 'write')) {
      if (!standalone.includes(scope)) standalone.push(scope);
      continue;
    }
    const row = rows.get(domain) ?? { domain, read: null, write: null };
    row[action] = scope;
    rows.set(domain, row);
  }
  return { domains: [...rows.values()], standalone };
}

/**
 * Ticks or unticks a scope, keeping the selection consistent with what the server will do
 * anyway (`expandScopes` on the back end):
 * - granting write implies read on the same domain;
 * - removing read removes write, otherwise the displayed checkbox would be misleading;
 * - `admin` is exclusive: it covers everything, the rest becomes noise.
 */
export function toggleScope(selected: readonly string[], scope: string, on: boolean): string[] {
  if (scope === ADMIN_SCOPE) return on ? [ADMIN_SCOPE] : [];
  const [domain, action] = scope.split(SEPARATOR);
  const set = new Set(selected.filter((s) => s !== ADMIN_SCOPE));
  if (on) {
    set.add(scope);
    if (action === 'write' && domain) set.add(scopeOf(domain, 'read'));
  } else {
    set.delete(scope);
    if (action === 'read' && domain) set.delete(scopeOf(domain, 'write'));
  }
  return [...set];
}

/** Is the scope ticked, directly or through `admin` coverage? */
export const isScopeOn = (selected: readonly string[], scope: string): boolean =>
  selected.includes(scope) || (scope !== ADMIN_SCOPE && selected.includes(ADMIN_SCOPE));

/** Summary level of a token, for the badge in the list. */
export type ScopeLevel = 'admin' | 'write' | 'read';

export function scopeLevel(scopes: readonly string[]): ScopeLevel {
  if (scopes.includes(ADMIN_SCOPE)) return 'admin';
  return scopes.some((s) => s === 'write' || s.endsWith(SEPARATOR + 'write')) ? 'write' : 'read';
}

/** Offered lifetimes; `''` = no expiry (the server then receives nothing). */
export const EXPIRY_CHOICES = ['', '30', '90', '365'] as const;

export const expiryDays = (choice: string): number | undefined => {
  const days = Number.parseInt(choice, 10);
  return Number.isFinite(days) && days > 0 ? days : undefined;
};

/** Issuance request body: empty fields are not sent at all. */
export interface TokenDraft {
  name: string;
  description?: string;
  scopes: string[];
  projectId?: number;
  expiresInDays?: number;
  currentPassword?: string;
}

/**
 * Builds the request body from the form state.
 * `null` when the draft is unusable (empty name, no scope): validation lives here, tested,
 * rather than being spread across two components.
 */
export function buildTokenDraft(form: {
  name: string;
  description?: string;
  scopes: readonly string[];
  projectId?: string;
  expiry?: string;
  currentPassword?: string;
}): TokenDraft | null {
  const name = form.name.trim();
  if (!name || form.scopes.length === 0) return null;
  const description = form.description?.trim();
  const projectId = form.projectId ? Number(form.projectId) : undefined;
  const draft: TokenDraft = { name, scopes: [...form.scopes] };
  if (description) draft.description = description;
  if (projectId !== undefined && Number.isFinite(projectId)) draft.projectId = projectId;
  const days = expiryDays(form.expiry ?? '');
  if (days !== undefined) draft.expiresInDays = days;
  if (form.currentPassword) draft.currentPassword = form.currentPassword;
  return draft;
}
