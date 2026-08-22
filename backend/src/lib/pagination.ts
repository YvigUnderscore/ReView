// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Pagination + tri serveur standardisés (10.D1, révisés pour la volumétrie long-métrage).
 *
 * Toute route de liste borne ses résultats via `paginationQuery` (schéma Zod commun)
 * et répond avec l'enveloppe `{ items, total, page, pageSize, pageCount, hasMore }`.
 *
 * Le défaut et le plafond étaient confondus (`max(100).default(100)`) : un appelant ne
 * pouvait rien demander de plus que ce qu'on lui servait déjà, si bien que la pagination
 * n'existait que sur le papier. Ils sont désormais distincts — défaut raisonnable pour
 * un écran, plafond assez haut pour un client qui sait ce qu'il fait.
 *
 * Deux modes coexistent, la réponse a la même forme dans les deux cas :
 * - **page/pageSize** : `skip`/`take`, le seul qui sache sauter à la page N ;
 * - **curseur** (`cursor`) : reprend après la dernière ligne servie. À 2000 plans, c'est
 *   le mode qui ne duplique ni ne saute de ligne quand une création s'intercale, et qui
 *   n'impose pas à Postgres de traverser N lignes avant de commencer à en rendre.
 */

/** Taille de page servie quand l'appelant n'en demande pas. */
export const DEFAULT_PAGE_SIZE = 100;

/** Plafond dur : au-delà, ce n'est plus une page mais un export. */
export const MAX_PAGE_SIZE = 500;

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Variante des grandes listes (plans, tâches) : le curseur est opaque et vient toujours
 * du `nextCursor` d'une réponse précédente. Fourni, il prime sur `page`.
 */
export const cursorPaginationQuery = paginationQuery.extend({
  cursor: z.string().min(1).max(300).optional(),
});

export type PaginationParams = z.infer<typeof cursorPaginationQuery>;

/**
 * Extrait + coerce les paramètres de pagination depuis `req.query`.
 * En Express 5, `req.query` est un getter : la coercition faite par le middleware
 * `validate` ne persiste pas (les valeurs restent des chaînes). On re-parse donc ici
 * pour obtenir des nombres fiables (les clés inconnues sont ignorées par le schéma).
 *
 * `defaultPageSize` sert aux listes qu'un écran consomme d'un bloc (arbre de séquences,
 * destinations d'upload) : elles restent bornées, mais pas à la taille d'une page de
 * cartes. Une valeur explicite de l'appelant l'emporte toujours.
 */
export function readPagination(query: unknown, opts: { defaultPageSize?: number } = {}): PaginationParams {
  const parsed = cursorPaginationQuery.parse(query);
  const asked =
    typeof query === 'object' && query !== null && (query as Record<string, unknown>).pageSize !== undefined;
  if (!asked && opts.defaultPageSize !== undefined) {
    parsed.pageSize = Math.min(Math.max(1, Math.trunc(opts.defaultPageSize)), MAX_PAGE_SIZE);
  }
  return parsed;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Nombre de pages (≥ 1), pour que le client n'ait pas à refaire l'arrondi. */
  pageCount: number;
  /** Reste-t-il des lignes après celles-ci ? C'est ce que lit un « charger la suite ». */
  hasMore: boolean;
}

/** Enveloppe des listes qui acceptent un curseur — `null` = fin de liste. */
export interface CursorPaginated<T> extends Paginated<T> {
  nextCursor: string | null;
}

/** Arguments Prisma `skip`/`take` dérivés de la page demandée. */
export function pageArgs(p: PaginationParams): { skip: number; take: number } {
  // Un curseur remplace le décalage : cumuler les deux sauterait une page entière.
  return { skip: p.cursor ? 0 : (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** Emballe une page de résultats dans l'enveloppe standard. */
export function paginate<T>(items: T[], total: number, p: PaginationParams): Paginated<T> {
  const pageCount = Math.max(1, Math.ceil(total / p.pageSize));
  // En mode curseur on ignore combien de lignes ont précédé : une page pleine signifie
  // qu'il en reste probablement, une page courte que la liste est finie.
  const hasMore = p.cursor ? items.length >= p.pageSize : (p.page - 1) * p.pageSize + items.length < total;
  return { items, total, page: p.page, pageSize: p.pageSize, pageCount, hasMore };
}

/**
 * Tri Prisma sûr : n'autorise que les colonnes de la liste blanche (défaut sinon),
 * évitant l'injection d'un champ arbitraire dans `orderBy`.
 */
export function orderByFrom(
  p: PaginationParams,
  allowed: readonly string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (p.sort && allowed.includes(p.sort)) return { [p.sort]: p.order };
  return fallback;
}

/**
 * Le même tri, rendu **total** par un départage sur `id`.
 *
 * Sans lui, `orderBy: { order: 'asc' }` sur deux mille plans importés par passes — tous
 * à `order = 0` — laisse Postgres libre de rendre les ex æquo dans un ordre différent
 * d'une requête à l'autre : la page 2 réaffiche des lignes de la page 1 et en saute
 * d'autres. Le départage est obligatoire dès qu'un `skip`/`take` s'applique.
 */
export function stableOrderBy(
  p: PaginationParams,
  allowed: readonly string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Array<Record<string, 'asc' | 'desc'>> {
  const primary = orderByFrom(p, allowed, fallback);
  if ('id' in primary) return [primary];
  const direction = Object.values(primary)[0] ?? 'asc';
  return [primary, { id: direction }];
}

/** Valeurs de tri qu'un curseur sait transporter. */
export type CursorValue = number | string | Date;

export interface DecodedCursor {
  value: CursorValue;
  id: number;
}

/**
 * Curseur opaque : la valeur de tri de la dernière ligne servie, plus son `id` de
 * départage. Le type est marqué (`n`/`s`/`d`) pour qu'un entier ne revienne pas en
 * chaîne — une comparaison Prisma sur le mauvais type est une erreur 500.
 */
export function encodeCursor(value: CursorValue, id: number): string {
  const tagged =
    value instanceof Date
      ? { k: 'd', v: value.toISOString(), i: id }
      : typeof value === 'number'
        ? { k: 'n', v: value, i: id }
        : { k: 's', v: value, i: id };
  return Buffer.from(JSON.stringify(tagged), 'utf8').toString('base64url');
}

/**
 * Décode un curseur. Un curseur illisible (tronqué, forgé, d'une version antérieure)
 * vaut « pas de curseur » : la liste repart du début plutôt que de répondre 500 pour un
 * paramètre que l'utilisateur n'a jamais tapé lui-même.
 */
export function decodeCursor(raw: string | undefined): DecodedCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { k, v, i } = parsed as { k?: unknown; v?: unknown; i?: unknown };
    if (typeof i !== 'number' || !Number.isInteger(i)) return null;
    if (k === 'n' && typeof v === 'number') return { value: v, id: i };
    if (k === 's' && typeof v === 'string') return { value: v, id: i };
    if (k === 'd' && typeof v === 'string') {
      const date = new Date(v);
      return Number.isNaN(date.getTime()) ? null : { value: date, id: i };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Filtre « strictement après ce curseur », en comparaison de couple `(champ, id)` :
 * c'est le pendant exact du tri `[{ champ }, { id }]`.
 */
export function cursorWhere(
  field: string,
  direction: 'asc' | 'desc',
  cur: DecodedCursor,
): Record<string, unknown> {
  const cmp = direction === 'asc' ? 'gt' : 'lt';
  if (field === 'id') return { id: { [cmp]: cur.id } };
  return {
    OR: [{ [field]: { [cmp]: cur.value } }, { AND: [{ [field]: cur.value }, { id: { [cmp]: cur.id } }] }],
  };
}

/**
 * Ajoute la condition de curseur à un `where` existant.
 *
 * Le filtre est empilé dans `AND` et jamais fusionné à la racine : plusieurs de nos
 * listes portent déjà un `OR` (une tâche pend à un plan **ou** à un asset), qu'un
 * étalement écraserait — et la liste renverrait alors tout le studio.
 */
export function withCursor<W>(where: W, p: PaginationParams, field: string, direction: 'asc' | 'desc'): W {
  const cur = decodeCursor(p.cursor);
  if (!cur) return where;
  const base = where as Record<string, unknown>;
  const previous = base.AND;
  const and = Array.isArray(previous) ? [...previous] : previous !== undefined ? [previous] : [];
  and.push(cursorWhere(field, direction, cur));
  return { ...base, AND: and } as W;
}

/**
 * Curseur à servir pour la suite. Une page incomplète marque la fin de la liste :
 * inutile de faire redemander au client une page qu'on sait vide.
 */
export function nextCursor<T extends { id: number }>(
  rows: T[],
  take: number,
  pick: (row: T) => CursorValue,
): string | null {
  if (rows.length < take || rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor(pick(last), last.id);
}

/** Emballe une page de résultats en y joignant le curseur de suite. */
export function paginateCursor<T extends { id: number }>(
  items: T[],
  total: number,
  p: PaginationParams,
  pick: (row: T) => CursorValue,
): CursorPaginated<T> {
  return { ...paginate(items, total, p), nextCursor: nextCursor(items, p.pageSize, pick) };
}
