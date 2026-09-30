// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Recherche plein texte sur les notes de review.
 *
 * Deux invariants s'y jouent : la requête ne doit **jamais** concaténer la saisie dans le
 * texte SQL (toute valeur passe en paramètre lié), et le cloisonnement doit être porté par
 * la clause `WHERE` elle-même. Le `$queryRaw` simulé est rejoué avec la vraie balise
 * `Prisma.sql` : le test lit donc le SQL final et les paramètres exactement tels que Prisma
 * les enverrait.
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

/** SQL final, placeholders numérotés (`$1`) — ce que Prisma envoie à Postgres. */
const sql = (): string => {
  if (!captured) throw new Error('no query captured');
  return captured.text;
};
const values = (): unknown[] => (captured ? captured.values : []);

describe('searchTokens / toTsQuery', () => {
  it('réduit la saisie à des tokens de lettres et de chiffres, en préfixe', () => {
    expect(searchTokens('Enlever le REFLET')).toEqual(['enlever', 'le', 'reflet']);
    expect(toTsQuery('enlever le reflet')).toBe('enlever:* & le:* & reflet:*');
  });

  it('neutralise tout opérateur de tsquery donné en saisie', () => {
    expect(toTsQuery("reflet & !fumée | (a <-> b) :* ' ")).toBe('reflet:* & fumée:* & a:* & b:*');
  });

  it('rend null quand rien n’est cherchable', () => {
    expect(toTsQuery('  ??? ')).toBeNull();
    expect(toTsQuery('')).toBeNull();
  });

  it('borne le nombre de tokens : une phrase collée n’est pas une requête', () => {
    expect(searchTokens('a b c d e f g h i j k')).toHaveLength(8);
  });
});

describe('htmlToPlainText / excerptAround', () => {
  it('rend le texte de l’éditeur riche, balises et entités défaites', () => {
    expect(htmlToPlainText('<p>Enlever&nbsp;le <strong>reflet</strong> &amp; la fumée</p>')).toBe(
      'Enlever le reflet & la fumée',
    );
  });

  it('ne laisse passer ni script ni style', () => {
    expect(htmlToPlainText('<p>ok</p><script>alert(1)</script>')).toBe('ok');
  });

  it('rend un contenu court tel quel', () => {
    expect(excerptAround('<p>Enlever le reflet</p>', ['reflet'])).toBe('Enlever le reflet');
  });

  it('centre l’extrait sur le terme trouvé et signale la troncature', () => {
    const long = `<p>${'bla '.repeat(60)}reflet ${'bla '.repeat(60)}</p>`;
    const out = excerptAround(long, ['reflet']);
    expect(out).toContain('reflet');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(162);
  });

  it('retombe sur le début du texte quand le terme n’y figure pas littéralement', () => {
    const long = `<p>${'mot '.repeat(80)}</p>`;
    expect(excerptAround(long, ['reflet']).startsWith('mot')).toBe(true);
  });
});

describe('searchComments — requête paramétrée', () => {
  it('n’interroge pas la base quand la saisie ne contient aucun token', async () => {
    expect(await searchComments('???', { userId: 1, role: Role.ADMIN, projectIds: null, limit: 8 })).toEqual(
      [],
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('n’interroge pas la base pour un compte sans aucun projet', async () => {
    expect(
      await searchComments('reflet', { userId: 1, role: Role.ARTIST, projectIds: [], limit: 8 }),
    ).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('passe la saisie en paramètre lié, jamais dans le texte SQL', async () => {
    await searchComments("reflet' OR 1=1 --", { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).not.toContain('OR 1=1');
    expect(values()).toContain('reflet:* & or:* & 1:* & 1:*');
  });

  it('réutilise à l’identique l’expression indexée en GIN', async () => {
    await searchComments('reflet', { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).toContain(`to_tsvector('simple', c."content") @@ to_tsquery('simple', $1)`);
  });

  it('borne le nombre de lignes rendues', async () => {
    await searchComments('reflet', { userId: 4, role: Role.ADMIN, projectIds: null, limit: 8 });
    expect(sql()).toContain('LIMIT');
    expect(values()).toContain(8);
  });
});

describe('searchComments — cloisonnement', () => {
  const scope = { userId: 4, role: Role.ARTIST, projectIds: [3, 9], limit: 8 };

  it('exclut la corbeille à chaque étage du chemin d’accès', async () => {
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

  it('borne un rôle non global à ses projets, identifiants passés en paramètres', async () => {
    await searchComments('reflet', scope);
    expect(sql()).toMatch(/p\."id" IN \(\$\d+,\$\d+\)/);
    expect(values()).toEqual(expect.arrayContaining([3, 9]));
  });

  it('n’ajoute aucun filtre de projet pour un rôle global', async () => {
    await searchComments('reflet', { ...scope, role: Role.ADMIN, projectIds: null });
    expect(sql()).not.toContain('p."id" IN');
  });

  it('ne montre les brouillons qu’à leur déposant', async () => {
    await searchComments('reflet', scope);
    expect(sql()).toMatch(/m\."published" = true OR m\."uploaderId" = \$\d+/);
    expect(values()).toContain(4);
  });

  it('refuse à un CLIENT les brouillons et les notes internes', async () => {
    await searchComments('reflet', { ...scope, role: Role.CLIENT });
    expect(sql()).toContain('c."isVisibleToClient" = true');
    expect(sql()).not.toContain('m."uploaderId"');
    expect(sql()).toContain('m."published" = true');
  });

  it('n’ajoute la clause CLIENT à personne d’autre', async () => {
    await searchComments('reflet', scope);
    expect(sql()).not.toContain('isVisibleToClient');
  });

  it('ne sélectionne jamais l’adresse de l’auteur', async () => {
    await searchComments('reflet', scope);
    expect(sql()).not.toContain('"email"');
  });
});

describe('searchComments — mise en forme', () => {
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

  it('rend l’extrait, l’auteur et le chemin lisible', async () => {
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

  it('retombe sur le nom d’invité, puis sur rien du tout — jamais sur l’adresse', async () => {
    rows = [
      { ...base, guestName: 'Client X' },
      { ...base, id: 52 },
    ];
    const hits = await searchComments('reflet', scope);
    expect(hits.map((h) => h.authorName)).toEqual(['Client X', null]);
  });

  it('nomme le porteur par son asset quand la note ne vient pas d’un plan', async () => {
    rows = [{ ...base, shotCode: null, assetName: 'robot' }];
    const [hit] = await searchComments('reflet', scope);
    expect(hit!.context).toBe('robot · SH0120_comp_v012.mov');
  });
});
