import { z } from 'zod';

/**
 * Pagination + tri serveur standardisés (10.D1).
 *
 * Toute route de liste borne ses résultats via `paginationQuery` (schéma Zod commun)
 * et répond avec l'enveloppe `{ items, total, page, pageSize }`. Les volumes studio
 * actuels restant petits, la taille de page par défaut est généreuse (100 = plafond).
 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationParams = z.infer<typeof paginationQuery>;

/**
 * Extrait + coerce les paramètres de pagination depuis `req.query`.
 * En Express 5, `req.query` est un getter : la coercition faite par le middleware
 * `validate` ne persiste pas (les valeurs restent des chaînes). On re-parse donc ici
 * pour obtenir des nombres fiables (les clés inconnues sont ignorées par le schéma).
 */
export function readPagination(query: unknown): PaginationParams {
  return paginationQuery.parse(query);
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Arguments Prisma `skip`/`take` dérivés de la page demandée. */
export function pageArgs(p: PaginationParams): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** Emballe une page de résultats dans l'enveloppe standard. */
export function paginate<T>(items: T[], total: number, p: PaginationParams): Paginated<T> {
  return { items, total, page: p.page, pageSize: p.pageSize };
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
