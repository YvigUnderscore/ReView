// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPaginationQuery,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  nextCursor,
  pageArgs,
  paginate,
  paginateCursor,
  paginationQuery,
  readPagination,
  stableOrderBy,
  withCursor,
} from './pagination';

const params = (over: Partial<ReturnType<typeof readPagination>> = {}) => ({
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  order: 'desc' as const,
  ...over,
});

describe('schéma de pagination', () => {
  it('sépare le défaut du plafond', () => {
    // Le plafond ÉTAIT le défaut (max 100 / default 100) : un appelant ne pouvait rien
    // demander de plus que ce qu'on lui servait, la pagination n'existait donc pas.
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(MAX_PAGE_SIZE);
    expect(paginationQuery.parse({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(paginationQuery.parse({ pageSize: '400' }).pageSize).toBe(400);
  });

  it('refuse au-delà du plafond et en deçà de 1', () => {
    expect(() => paginationQuery.parse({ pageSize: String(MAX_PAGE_SIZE + 1) })).toThrow();
    expect(() => paginationQuery.parse({ page: '0' })).toThrow();
  });

  it('accepte un curseur sur la variante dédiée', () => {
    expect(cursorPaginationQuery.parse({ cursor: 'abc' }).cursor).toBe('abc');
    expect(cursorPaginationQuery.parse({}).cursor).toBeUndefined();
  });
});

describe('readPagination', () => {
  it('coerce les chaînes de req.query', () => {
    expect(readPagination({ page: '3', pageSize: '25' })).toMatchObject({ page: 3, pageSize: 25 });
  });

  it('applique le défaut propre à la route quand rien n’est demandé', () => {
    expect(readPagination({}, { defaultPageSize: 500 }).pageSize).toBe(500);
  });

  it('laisse toujours la main à l’appelant', () => {
    expect(readPagination({ pageSize: '10' }, { defaultPageSize: 500 }).pageSize).toBe(10);
  });

  it('ne laisse pas un défaut de route franchir le plafond', () => {
    expect(readPagination({}, { defaultPageSize: 99999 }).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('pageArgs / paginate', () => {
  it('décale de (page - 1) × pageSize', () => {
    expect(pageArgs(params({ page: 3, pageSize: 20 }))).toEqual({ skip: 40, take: 20 });
  });

  it('ignore le décalage quand un curseur est fourni', () => {
    // Cumuler skip et curseur sauterait une page entière.
    expect(pageArgs(params({ page: 3, pageSize: 20, cursor: 'c' }))).toEqual({ skip: 0, take: 20 });
  });

  it('expose un total exploitable : pageCount et hasMore', () => {
    const p = params({ page: 1, pageSize: 100 });
    expect(paginate(new Array(100).fill(0), 250, p)).toMatchObject({
      total: 250,
      pageCount: 3,
      hasMore: true,
    });
    expect(paginate(new Array(50).fill(0), 250, params({ page: 3, pageSize: 100 }))).toMatchObject({
      pageCount: 3,
      hasMore: false,
    });
  });

  it('pageCount vaut 1 sur une liste vide', () => {
    expect(paginate([], 0, params()).pageCount).toBe(1);
  });

  it('en mode curseur, une page pleine annonce une suite', () => {
    const p = params({ pageSize: 2, cursor: 'c' });
    expect(paginate([1, 2], 999, p).hasMore).toBe(true);
    expect(paginate([1], 999, p).hasMore).toBe(false);
  });
});

describe('stableOrderBy', () => {
  it('ajoute un départage sur id, dans le même sens', () => {
    expect(stableOrderBy(params({ sort: 'name', order: 'asc' }), ['name'], { name: 'asc' })).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('retombe sur le tri par défaut si la colonne n’est pas autorisée', () => {
    expect(stableOrderBy(params({ sort: 'passwordHash' }), ['name'], { createdAt: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('ne double pas le départage quand on trie déjà par id', () => {
    expect(stableOrderBy(params({ sort: 'id', order: 'asc' }), ['id'], { id: 'asc' })).toEqual([
      { id: 'asc' },
    ]);
  });
});

describe('curseur', () => {
  it('fait un aller-retour sur un entier, une chaîne et une date', () => {
    const date = new Date('2026-08-21T10:00:00.000Z');
    expect(decodeCursor(encodeCursor(0, 42))).toEqual({ value: 0, id: 42 });
    expect(decodeCursor(encodeCursor('SH010', 7))).toEqual({ value: 'SH010', id: 7 });
    expect(decodeCursor(encodeCursor(date, 9))).toEqual({ value: date, id: 9 });
  });

  it('ne rend pas un nombre sous forme de chaîne', () => {
    // Une comparaison Prisma sur le mauvais type est une erreur 500, pas un tri bancal.
    expect(typeof decodeCursor(encodeCursor(12, 1))!.value).toBe('number');
  });

  it('traite un curseur illisible comme une absence de curseur', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('pas-du-base64-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"k":"n","v":1}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"k":"d","v":"jamais","i":1}').toString('base64url'))).toBeNull();
  });

  it('compare le couple (valeur, id), pas la seule valeur', () => {
    // C'est tout l'intérêt : deux mille plans à order = 0 ne peuvent se départager que
    // par l'id, sinon la page suivante repart du premier ex æquo.
    expect(cursorWhere('order', 'asc', { value: 0, id: 12 })).toEqual({
      OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 12 } }] }],
    });
  });

  it('inverse la comparaison en tri descendant', () => {
    expect(cursorWhere('createdAt', 'desc', { value: 5, id: 3 })).toEqual({
      OR: [{ createdAt: { lt: 5 } }, { AND: [{ createdAt: 5 }, { id: { lt: 3 } }] }],
    });
  });

  it('se réduit à l’id quand c’est déjà la clé de tri', () => {
    expect(cursorWhere('id', 'asc', { value: 4, id: 4 })).toEqual({ id: { gt: 4 } });
  });
});

describe('withCursor', () => {
  it('laisse le filtre intact sans curseur', () => {
    const where = { projectId: 1 };
    expect(withCursor(where, params(), 'order', 'asc')).toBe(where);
  });

  it('empile la condition dans AND sans écraser un OR existant', () => {
    // Une tâche pend à un plan OU à un asset : étaler le curseur à la racine écraserait
    // ce OR et la liste renverrait les tâches de tout le studio.
    const where = { OR: [{ shotId: 1 }, { assetId: 2 }] };
    const out = withCursor(where, params({ cursor: encodeCursor(0, 5) }), 'order', 'asc') as {
      OR: unknown[];
      AND: unknown[];
    };
    expect(out.OR).toEqual(where.OR);
    expect(out.AND).toHaveLength(1);
    expect(out.AND[0]).toEqual(cursorWhere('order', 'asc', { value: 0, id: 5 }));
  });

  it('conserve un AND déjà présent', () => {
    const where = { AND: [{ deletedAt: null }] };
    const out = withCursor(where, params({ cursor: encodeCursor(1, 2) }), 'order', 'asc') as {
      AND: unknown[];
    };
    expect(out.AND).toHaveLength(2);
    expect(out.AND[0]).toEqual({ deletedAt: null });
  });
});

describe('nextCursor / paginateCursor', () => {
  const rows = [
    { id: 1, order: 0 },
    { id: 2, order: 0 },
  ];

  it('ne rend pas de curseur sur une page incomplète', () => {
    expect(nextCursor(rows, 10, (r) => r.order)).toBeNull();
    expect(nextCursor([], 10, (r: { id: number }) => r.id)).toBeNull();
  });

  it('rend le couple de la dernière ligne servie sur une page pleine', () => {
    expect(decodeCursor(nextCursor(rows, 2, (r) => r.order) ?? undefined)).toEqual({
      value: 0,
      id: 2,
    });
  });

  it('joint le curseur à l’enveloppe standard', () => {
    const page = paginateCursor(rows, 40, params({ pageSize: 2 }), (r) => r.order);
    expect(page).toMatchObject({ total: 40, page: 1, pageSize: 2, pageCount: 20, hasMore: true });
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({ value: 0, id: 2 });
  });
});
