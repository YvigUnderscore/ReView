// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Full-text search over review notes.
 *
 * Two invariants play out here: the query must **never** concatenate the input into the SQL text (every value goes through a bound parameter), and the
 * partitioning must be carried by the `WHERE` clause itself. The simulated `$queryRaw` is replayed with the real `Prisma.sql` tag: the test thus reads the
 * final SQL and the parameters exactly as Prisma would send them.
 */

vi.mock('./prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

import { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';
import { searchComments, searchTokens, toTsQuery, htmlToPlainText, excerptAround } from './searchComments';

let captured: Prisma.Sql | null = null;
let rows: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  rows = [];
  vi.mocked(prisma.$queryRaw).mockImplementation(((
    strings: TemplateStringsArray,
    ...raw: Parameters<typeof Prisma.sql>[1][]
  ) => {
    captured = Prisma.sql(strings, ...raw);
    return Promise.resolve(rows);
  }) as never);
});

/** Final SQL, numbered placeholders (`$1`) — what Prisma sends to Postgres. */
const sql = (): string => {
  if (!captured) throw new Error('no query captured');
  return captured.text;
};
const values = (): unknown[] => (captured ? captured.values : []);

describe('searchTokens / toTsQuery', () => {
  it('reduces the input to tokens of letters and digits, as prefixes', () => {
    expect(searchTokens('Enlever le REFLET')).toEqual(['enlever', 'le', 'reflet']);
    expect(toTsQuery('enlever le reflet')).toBe('enlever:* & le:* & reflet:*');
  });

  it('neutralises any tsquery operator given as input', () => {
    expect(toTsQuery("reflet & !fumée | (a <-> b) :* ' ")).toBe('reflet:* & fumée:* & a:* & b:*');
  });

  it('returns null when nothing is searchable', () => {
    expect(toTsQuery('  ??? ')).toBeNull();
    expect(toTsQuery('')).toBeNull();
  });

  it('bounds the number of tokens: a pasted sentence is not a query', () => {
    expect(searchTokens('a b c d e f g h i j k')).toHaveLength(8);
  });
});

describe('htmlToPlainText / excerptAround', () => {
  it('returns the rich editor text, tags and entities undone', () => {
    expect(htmlToPlainText('<p>Enlever&nbsp;le <strong>reflet</strong> &amp; la fumée</p>')).toBe(
      'Enlever le reflet & la fumée',
    );
  });

  it('lets neither script nor style through', () => {
    expect(htmlToPlainText('<p>ok</p><script>alert(1)</script>')).toBe('ok');
  });

  it('returns a short content as-is', () => {
    expect(excerptAround('<p>Enlever le reflet</p>', ['reflet'])).toBe('Enlever le reflet');
  });

  it('centres the excerpt on the term found and flags the truncation', () => {
    const long = `<p>${'bla '.repeat(60)}reflet ${'bla '.repeat(60)}</p>`;
    const out = excerptAround(long, ['reflet']);
    expect(out).toContain('reflet');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(162);
  });

  it('falls back on the beginning of the text when the term does not appear literally in it', () => {
    const long = `<p>${'mot '.repeat(80)}</p>`;
    expect(excerptAround(long, ['reflet']).startsWith('mot')).toBe(true);
  });
});

describe('searchComments — parameterised query', () => {
  it('does not query the database when the input contains no token', async () => {
    expect(await searchComments('???', { userId: 1, role: Role.ADMIN, projectIds: null, limit: 8 })).toEqual(
      [],
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not query the database for an account without any project', async () => {
    expect(
      await searchComments('reflet', { userId: 1, role: Role.ARTIST, projectIds: [], limit: 8 }),
    ).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('passes the input as a bound parameter, never in the SQL text', async () => {
    await searchComments("reflet' OR 1=1 --", { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).not.toContain('OR 1=1');
    expect(values()).toContain('reflet:* & or:* & 1:* & 1:*');
  });

  it('reuses the GIN-indexed expression identically', async () => {
    await searchComments('reflet', { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).toContain(`to_tsvector('simple', c."content") @@ to_tsquery('simple', $1)`);
  });

  it('bounds the number of rows returned', async () => {
    await searchComments('reflet', { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).toContain('LIMIT');
    expect(values()).toContain(8);
  });
});

describe('searchComments — partitioning', () => {
  const scope = { userId: 4, role: Role.ARTIST, projectIds: [3, 9], limit: 8 };

  it('excludes the trash at every level of the access path', async () => {
    await searchComments('reflet', scope);
    for (const clause of [
      'm."deletedAt" IS NULL',
      'v."deletedAt" IS NULL',
      'p."deletedAt" IS NULL',
      's."id" IS NULL OR s."deletedAt" IS NULL',
      'a."id" IS NULL OR a."deletedAt" IS NULL',
    ]) {
      expect(sql()).toContain(clause);
    }
  });

  it('bounds a non-global role to their projects, identifiers passed as parameters', async () => {
    await searchComments('reflet', scope);
    expect(sql()).toMatch(/p\."id" IN \(\$\d+,\$\d+\)/);
    expect(values()).toEqual(expect.arrayContaining([3, 9]));
  });

  it('adds no project filter for a global role', async () => {
    await searchComments('reflet', { ...scope, role: Role.ADMIN, projectIds: null });
    expect(sql()).not.toContain('p."id" IN');
  });

  it('shows drafts only to their uploader', async () => {
    await searchComments('reflet', scope);
    expect(sql()).toMatch(/m\."published" = true OR m\."uploaderId" = \$\d+/);
    expect(values()).toContain(4);
  });

  it('refuses a CLIENT the drafts and the internal notes', async () => {
    await searchComments('reflet', { ...scope, role: Role.CLIENT });
    expect(sql()).toContain('c."isVisibleToClient" = true');
    expect(sql()).not.toContain('m."uploaderId"');
    expect(sql()).toContain('m."published" = true');
  });

  it('adds the CLIENT clause to nobody else', async () => {
    await searchComments('reflet', scope);
    expect(sql()).not.toContain('isVisibleToClient');
  });

  it('never selects the address of the author', async () => {
    await searchComments('reflet', scope);
    expect(sql()).not.toContain('"email"');
  });
});

describe('searchComments — formatting', () => {
  const scope = { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 };
  const base = {
    id: 51,
    mediaObjectId: 88,
    content: '<p>Enlever le reflet sur le casque</p>',
    createdAt: new Date('2026-08-21T10:00:00Z'),
    guestName: null,
    username: null,
    name: null,
    firstName: null,
    lastName: null,
    shotCode: 'SH0120',
    assetName: null,
    originalName: 'SH0120_comp_v012.mov',
  };

  it('returns the excerpt, the author and the readable path', async () => {
    rows = [{ ...base, username: 'ana' }];
    const [hit] = await searchComments('reflet', scope);
    expect(hit).toEqual({
      id: 51,
      mediaObjectId: 88,
      excerpt: 'Enlever le reflet sur le casque',
      authorName: 'ana',
      createdAt: base.createdAt,
      context: 'SH0120 · SH0120_comp_v012.mov',
    });
  });

  it('falls back on the guest name, then on nothing at all — never on the address', async () => {
    rows = [
      { ...base, guestName: 'Client X' },
      { ...base, id: 52 },
    ];
    const hits = await searchComments('reflet', scope);
    expect(hits.map((h) => h.authorName)).toEqual(['Client X', null]);
  });

  it('names the carrier by its asset when the note does not come from a shot', async () => {
    rows = [{ ...base, shotCode: null, assetName: 'robot' }];
    const [hit] = await searchComments('reflet', scope);
    expect(hit!.context).toBe('robot · SH0120_comp_v012.mov');
  });
});
