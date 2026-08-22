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
 *
 * **Le catalogue ne décrit que ce qui est réellement gardé.** Neuf scopes déclarés ici
 * n'étaient exigés par aucune route : `playlists:*`, `webhooks:*`, `users:*`,
 * `projects:write` et `events:write`. Un scope qui ne protège rien est pire qu'absent —
 * il se coche à la création d'un token, il se lit dans la documentation, et il laisse
 * croire à un cantonnement qui n'existe pas. Ils sont retirés ; les familles concernées
 * ne sont tout simplement pas exposées par `/api/v1` (les webhooks et l'annuaire vivent
 * sur l'API interne, que `apiTokenSurface` ferme aux jetons).
 */

export type ScopeAction = 'read' | 'write';

/**
 * Domaines adressables, et pour chacun les actions qu'une route v1 exige vraiment.
 *
 * Ajouter une action ici sans la poser sur une route la remettrait dans le même état :
 * la table est la déclaration, `requireScope` est l'usage, et les deux doivent bouger
 * ensemble.
 */
const DOMAIN_ACTIONS = {
  // Lecture seule : la création d'un projet n'appartient pas à l'API d'intégration.
  projects: ['read'],
  sequences: ['read', 'write'],
  shots: ['read', 'write'],
  assets: ['read', 'write'],
  tasks: ['read', 'write'],
  versions: ['read', 'write'],
  media: ['read', 'write'],
  comments: ['read', 'write'],
  // Le journal d'événements se lit ; il s'écrit tout seul.
  events: ['read'],
} as const satisfies Readonly<Record<string, readonly ScopeAction[]>>;

export type ScopeDomain = keyof typeof DOMAIN_ACTIONS;

/** Domaines adressables par un token. Un domaine = une famille de ressources v1. */
export const SCOPE_DOMAINS = Object.keys(DOMAIN_ACTIONS) as readonly ScopeDomain[];

/** Exactement les couples déclarés ci-dessus — `projects:write` n'existe pas. */
export type Scope =
  { [D in ScopeDomain]: `${D}:${(typeof DOMAIN_ACTIONS)[D][number]}` }[ScopeDomain] | 'admin';

/** Scopes hérités (tokens créés avant les scopes fins) — conservés pour compatibilité. */
export const LEGACY_SCOPES = ['read', 'write'] as const;

/** Tous les scopes fins attribuables, dans un ordre stable (doc, UI, tests). */
export const ALL_SCOPES: readonly Scope[] = [
  ...SCOPE_DOMAINS.flatMap((d): Scope[] => DOMAIN_ACTIONS[d].map((a) => `${d}:${a}` as Scope)),
  'admin',
];

const SCOPE_SET = new Set<string>(ALL_SCOPES);

/** Chaîne acceptée à la création d'un token : scope fin ou scope hérité. */
export const isGrantableScope = (value: string): boolean =>
  SCOPE_SET.has(value) || (LEGACY_SCOPES as readonly string[]).includes(value);

/**
 * Développe les scopes stockés en scopes fins effectifs.
 * - `read`  → tous les `*:read`
 * - `write` → tous les `*:read` ET les `*:write` déclarés (une écriture suppose de relire)
 * - `admin` → tout
 *
 * Un scope stocké qui n'est plus au catalogue (un `playlists:read` d'hier) est ignoré
 * comme n'importe quelle chaîne inconnue : le token reste valide, et il ne perd aucun
 * pouvoir puisque aucune route n'a jamais consulté ce scope.
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
  // Une écriture accordée finement implique la lecture du même domaine.
  for (const s of [...out]) {
    const [domain, action] = s.split(':');
    if (action === 'write' && domain) out.add(`${domain}:read` as Scope);
  }
  return out;
}

/** Le token couvre-t-il le scope demandé ? `admin` couvre tout. */
export function hasScope(stored: readonly string[], required: Scope): boolean {
  const granted = expandScopes(stored);
  return granted.has('admin') || granted.has(required);
}
