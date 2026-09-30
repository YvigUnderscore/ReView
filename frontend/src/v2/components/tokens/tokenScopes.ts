// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Helpers PURS du modèle de droits machine — la logique que l'écran des tokens partage
 * entre le profil (token personnel) et l'administration (token de service).
 *
 * Le catalogue de scopes n'est jamais recopié ici : il arrive de `GET /api/auth/scopes`.
 * Ce fichier ne fait que le mettre en forme (`domaine:action` → une ligne par domaine) et
 * tenir la cohérence des cases cochées. Conséquence voulue : le jour où le serveur retire
 * un scope de son catalogue, l'écran cesse de le proposer sans qu'on y touche.
 */

/** Une ligne du sélecteur : un domaine et les actions que le serveur y déclare. */
export interface ScopeDomainRow {
  domain: string;
  /** Scope complet (`versions:read`) ou `null` si le serveur ne le déclare pas. */
  read: string | null;
  write: string | null;
}

export interface GroupedScopes {
  domains: ScopeDomainRow[];
  /** Scopes sans domaine — `admin` aujourd'hui : ils gouvernent tout, on les isole. */
  standalone: string[];
}

/** Scope qui couvre tout : cocher autre chose à côté n'aurait aucun sens. */
export const ADMIN_SCOPE = 'admin';

/** Sépare le domaine de l'action dans un scope (`versions:write`). */
const SEPARATOR = ':';

/**
 * Recompose un scope. Assemblé par `join` et non par un gabarit : le contrôle des textes
 * en dur voit dans `` `${domain}:read` `` une phrase autour d'une interpolation, et il a
 * raison de s'en méfier — ici c'est un identifiant d'API, pas de la prose.
 */
const scopeOf = (domain: string, action: 'read' | 'write'): string => [domain, action].join(SEPARATOR);

/**
 * Regroupe le catalogue par domaine, dans l'ordre où le serveur l'a servi.
 * Un scope mal formé (sans `:`) est traité comme un scope global plutôt qu'ignoré : mieux
 * vaut une case en trop qu'un droit invisible.
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
 * Coche ou décoche un scope en gardant la sélection cohérente avec ce que le serveur
 * fera de toute façon (`expandScopes` côté back) :
 * - une écriture accordée implique la lecture du même domaine ;
 * - retirer la lecture retire l'écriture, sinon la case affichée mentirait ;
 * - `admin` est exclusif : il couvre tout, le reste devient du bruit.
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

/** Le scope est-il coché, directement ou par la couverture d'`admin` ? */
export const isScopeOn = (selected: readonly string[], scope: string): boolean =>
  selected.includes(scope) || (scope !== ADMIN_SCOPE && selected.includes(ADMIN_SCOPE));

/** Niveau résumé d'un token, pour la pastille de la liste. */
export type ScopeLevel = 'admin' | 'write' | 'read';

export function scopeLevel(scopes: readonly string[]): ScopeLevel {
  if (scopes.includes(ADMIN_SCOPE)) return 'admin';
  return scopes.some((s) => s === 'write' || s.endsWith(SEPARATOR + 'write')) ? 'write' : 'read';
}

/** Durées de vie proposées ; `''` = pas d'expiration (le serveur reçoit alors rien). */
export const EXPIRY_CHOICES = ['', '30', '90', '365'] as const;

export const expiryDays = (choice: string): number | undefined => {
  const days = Number.parseInt(choice, 10);
  return Number.isFinite(days) && days > 0 ? days : undefined;
};

/** Corps d'émission d'un token — les champs vides ne sont pas envoyés du tout. */
export interface TokenDraft {
  name: string;
  description?: string;
  scopes: string[];
  projectId?: number;
  expiresInDays?: number;
  currentPassword?: string;
}

/**
 * Construit le corps de la requête à partir de l'état du formulaire.
 * `null` quand le brouillon est inexploitable (nom vide, aucun scope) : la validation
 * vit ici, testée, plutôt que dispersée dans deux composants.
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
