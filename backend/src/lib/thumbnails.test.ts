// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}`)) },
}));

import { Prisma } from '@prisma/client';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeysForShots,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForEpisodes,
  firstMediaThumbKeysForProjects,
} from './thumbnails';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const queryRaw = vi.mocked(prisma.$queryRaw);

/**
 * Reconstitue la requête réellement envoyée : le texte SQL (espaces normalisés) et les
 * paramètres liés. C'est ce qui permet de vérifier la règle d'élection ET le fait que les
 * identifiants de la page voyagent en paramètres, jamais concaténés dans le texte.
 */
function sqlOf(call: number): { text: string; values: unknown[] } {
  const args = queryRaw.mock.calls[call] as unknown as [TemplateStringsArray, ...Prisma.Sql[]];
  const built = Prisma.sql(args[0], ...args.slice(1));
  return { text: built.text.replace(/\s+/g, ' ').trim(), values: built.values };
}

beforeEach(() => vi.clearAllMocks());

/**
 * La miniature « effective » d'une carte : celle choisie à la main si elle existe, sinon
 * celle du premier média publié. C'est le seul point qui présigne les vignettes de liste —
 * une centaine d'appels par ouverture de projet.
 */
describe('effectiveThumbnailUrl', () => {
  it('préfère la vignette explicite au repli', async () => {
    await expect(effectiveThumbnailUrl('entity-thumbs/shot/1.jpg', 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/entity-thumbs/shot/1.jpg',
    );
  });

  it('retombe sur le premier média publié', async () => {
    await expect(effectiveThumbnailUrl(null, 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/derived/9/thumbnail.jpg',
    );
  });

  it('ne signe rien quand l’entité n’a aucune image', async () => {
    await expect(effectiveThumbnailUrl(null, null)).resolves.toBeNull();
    expect(storage.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

/**
 * Variantes groupées : une requête pour toute une page de cartes. La règle d'élection
 * (le média publié le plus ancien gagne) est celle de la variante unitaire — la vérifier
 * ici évite qu'une page ne change de vignette selon le chemin de code emprunté.
 *
 * L'élection se fait en base (`DISTINCT ON`) et non plus en mémoire : c'est le correctif
 * PERF-02. Le `findMany` d'avant rapatriait TOUS les médias publiés des cent plans de la
 * page (2 009 lignes mesurées à dix versions par plan) pour n'en garder que cent.
 */
describe('miniatures groupées', () => {
  it('élit le média le plus ancien de chaque plan, en une requête', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 1, thumbnailKey: 'a.jpg' },
      { parentId: 2, thumbnailKey: 'c.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForShots([1, 2])).resolves.toEqual(
      new Map([
        [1, 'a.jpg'],
        [2, 'c.jpg'],
      ]),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = sqlOf(0);
    // Une ligne par plan, la plus ancienne ; `m.id` départage deux médias créés à la même
    // milliseconde, que l'élection en mémoire laissait au hasard du plan d'exécution.
    expect(text).toContain('DISTINCT ON (t."shotId")');
    expect(text).toContain('ORDER BY t."shotId", m."createdAt" ASC, m.id ASC');
    expect(text).toContain('t."shotId" IN ($1,$2)');
    expect(values).toEqual([1, 2]);
  });

  it('ne rapatrie plus toute la page pour n’en garder qu’une ligne par parent', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForShots([1, 2]);
    await firstMediaThumbKeysForAssets([5]);
    await firstMediaThumbKeysForSequences([3]);
    await firstMediaThumbKeysForEpisodes([7]);
    // La lecture large (tous les médias candidats, élection dans Node) n'existe plus.
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i += 1) expect(sqlOf(i).text).toContain('DISTINCT ON');
  });

  it('garde le filtre d’origine : publié, non supprimé, doté d’une vignette', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForShots([1]);
    const { text } = sqlOf(0);
    expect(text).toContain('m.published = true');
    expect(text).toContain('m."deletedAt" IS NULL');
    expect(text).toContain('m."thumbnailKey" IS NOT NULL');
  });

  it('rattache l’asset porté par la version comme celui porté par la tâche', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 5, thumbnailKey: 'direct.jpg' },
      { parentId: 6, thumbnailKey: 'viaTask.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForAssets([5, 6])).resolves.toEqual(
      new Map([
        [5, 'direct.jpg'],
        [6, 'viaTask.jpg'],
      ]),
    );
    const { text, values } = sqlOf(0);
    expect(text).toContain('DISTINCT ON (COALESCE(v."assetId", t."assetId"))');
    // Les deux chemins de rattachement, donc les identifiants passés deux fois.
    expect(values).toEqual([5, 6, 5, 6]);
  });

  it('n’interroge pas la base pour une page vide', async () => {
    await expect(firstMediaThumbKeysForShots([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForAssets([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForSequences([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForEpisodes([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

/**
 * Le repli d'un projet est élu par une seule requête SQL (`DISTINCT ON`) : la variante
 * unitaire dans un `.map` faisait cent `findFirst` à triple OR par ouverture de la barre
 * latérale. La liste des projets ET l'accueil s'en servent — les deux doivent montrer la
 * même image du même projet.
 */
describe('miniatures de projet', () => {
  it('associe chaque clé au projet qu’elle vient de, en une requête', async () => {
    queryRaw.mockResolvedValue([
      { projectId: 3, thumbnailKey: 'thumbs/c.jpg' },
      { projectId: 1, thumbnailKey: 'thumbs/a.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForProjects([1, 2, 3])).resolves.toEqual(
      new Map([
        [3, 'thumbs/c.jpg'],
        [1, 'thumbs/a.jpg'],
      ]),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('n’interroge rien quand la page est vide', async () => {
    await expect(firstMediaThumbKeysForProjects([])).resolves.toEqual(new Map());
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

/**
 * Séquences et épisodes n'avaient aucune image de repli : leurs cartes restaient vides même
 * une fois le travail livré, faute de règle. Ils héritent de celle des plans — le premier
 * média publié — en la remontant d'un cran (plan → séquence) ou de deux (→ épisode).
 */
describe('miniatures de séquence et d’épisode', () => {
  it('remonte au plan pour élire l’image d’une séquence', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 3, thumbnailKey: 'a.jpg' },
      { parentId: 4, thumbnailKey: 'c.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForSequences([3, 4])).resolves.toEqual(
      new Map([
        [3, 'a.jpg'],
        [4, 'c.jpg'],
      ]),
    );
    expect(sqlOf(0).text).toContain('DISTINCT ON (sh."sequenceId")');
  });

  it('écarte les plans supprimés ou masqués — une séquence ne porte pas l’image d’un plan qu’on n’y voit plus', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForSequences([3]);
    const { text, values } = sqlOf(0);
    expect(text).toContain('sh."sequenceId" IN ($1)');
    expect(text).toContain('sh."deletedAt" IS NULL');
    expect(text).toContain('sh."hiddenAt" IS NULL');
    expect(values).toEqual([3]);
  });

  it('remonte jusqu’à l’épisode à travers la séquence du plan, séquence supprimée exclue', async () => {
    queryRaw.mockResolvedValue([{ parentId: 7, thumbnailKey: 'ep.jpg' }] as never);
    await expect(firstMediaThumbKeysForEpisodes([7])).resolves.toEqual(new Map([[7, 'ep.jpg']]));
    const { text, values } = sqlOf(0);
    expect(text).toContain('DISTINCT ON (sq."episodeId")');
    expect(text).toContain('sq."deletedAt" IS NULL');
    expect(text).toContain('sh."deletedAt" IS NULL');
    expect(text).toContain('sh."hiddenAt" IS NULL');
    expect(values).toEqual([7]);
  });

  it('ignore un média dont la chaîne de rattachement est rompue', async () => {
    // Une version rattachée à un asset n'a pas de tâche, donc pas de plan : elle ne dit
    // rien d'une séquence et ne doit pas s'y afficher. Ce sont les jointures fermées
    // (`JOIN`, pas `LEFT JOIN`) qui l'écartent en base.
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForSequences([3]);
    const { text } = sqlOf(0);
    expect(text).toContain('JOIN "Task" t ON t.id = v."taskId"');
    expect(text).toContain('JOIN "Shot" sh ON sh.id = t."shotId"');
    expect(text).not.toContain('LEFT JOIN');
  });
});
