// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';
import { bestScore, rankBy } from './searchRank';
import { excerptAround, searchTokens } from './searchComments';

/**
 * Ce que la recherche globale ne trouvait pas.
 *
 * `searchEntities` interrogeait dix types — le pipe, les versions, les médias, les notes de
 * review, les personnes — et rien d'autre. Le produit en contient davantage : taper le nom
 * d'un département (« Modeling ») ou d'un épisode ne rendait rien du tout, et les montages,
 * les boards et les fiches d'entité (le brief, là où vit ce qu'un plan doit devenir)
 * n'étaient atteignables qu'en sachant déjà où cliquer.
 *
 * Ces cinq familles vivent ici plutôt que dans `search.ts` pour deux raisons : le fichier
 * d'origine tenait déjà son propre poids, et surtout ces types ne se filtrent pas comme les
 * autres — un département peut n'appartenir à aucun projet, un montage peut n'avoir aucun
 * nom, une fiche appartient à son entité porteuse plus qu'à elle-même.
 *
 * **Cloisonnement.** Même règle que dans `search.ts` : le filtre d'accès est écrit dans la
 * clause `where`, jamais appliqué après coup. La corbeille (`deletedAt`) et le masquage
 * (`hiddenAt`) excluent partout, y compris quand ils portent sur l'entité **porteuse** —
 * la fiche d'un plan masqué n'est pas un résultat, c'est une fuite.
 */

/**
 * Nombre de résultats par type. Volontairement plus court que pour les shots ou les
 * médias : ce sont des référentiels ou des écrans uniques, pas des listes qui suivent la
 * production, et la palette doit rester lisible d'un coup d'œil.
 */
export const EXTRA_LIMITS = {
  episodes: 5,
  departments: 5,
  timelines: 4,
  boards: 3,
  briefs: 5,
} as const;

/** Entité porteuse d'une fiche — c'est elle qui décide de la page à ouvrir. */
export type BriefHolder = 'episode' | 'sequence' | 'shot' | 'asset';

export interface ExtraResults {
  episodes: { id: number; code: string; name: string; projectId: number }[];
  /** `projectId` à `null` = référentiel du studio, hérité par tous les projets. */
  departments: { id: number; name: string; key: string; projectId: number | null }[];
  /** `name` à `null` quand personne n'a renommé le montage : l'écran affiche son libellé traduit. */
  timelines: { id: number; name: string | null; projectName: string; sequenceCode: string | null }[];
  boards: { id: number; projectId: number | null; assetId: number | null; name: string }[];
  briefs: { id: number; holder: BriefHolder; holderId: number; label: string; excerpt: string }[];
}

/** Filtre textuel commun, monté une fois par `searchEntities`. */
export type Contains = { contains: string; mode: 'insensitive' };

export interface ExtraScope {
  /** Projets lisibles par le demandeur (cf. `projectScope`). */
  project: Prisma.ProjectWhereInput;
  role: Role;
}

/**
 * Les départements ne mènent qu'aux écrans où on les configure — le référentiel du studio
 * (`/admin/defaults`) ou l'onglet « Réglages » d'un projet. Les proposer à qui ne peut pas
 * les ouvrir, c'est promettre une porte fermée ; l'artiste qui tape « Modeling », lui,
 * trouve ses tâches de ce département (cf. la recherche de tâches dans `search.ts`).
 */
const canOpenDepartments = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Une entité de production visible : ni à la corbeille, ni masquée. */
const VISIBLE = { deletedAt: null, hiddenAt: null } as const;

/** Épisodes — même fiche qu'une séquence : code, nom, description. */
async function searchEpisodes(
  contains: Contains,
  { project }: ExtraScope,
): Promise<ExtraResults['episodes']> {
  const rows = await prisma.episode.findMany({
    where: {
      ...VISIBLE,
      project,
      OR: [{ code: contains }, { name: contains }, { description: contains }],
    },
    select: { id: true, code: true, name: true, description: true, projectId: true },
    orderBy: { id: 'desc' },
    take: EXTRA_LIMITS.episodes,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.code, field: 'code' },
      { value: row.name, field: 'name' },
      { value: row.description, field: 'description' },
    ]),
  ).map(({ id, code, name, projectId }) => ({ id, code, name, projectId }));
}

/**
 * Départements du pipe. Deux origines dans la même table : le référentiel du studio
 * (`projectId` nul, hérité partout) et les étapes propres à un projet, qui suivent l'accès
 * de ce projet.
 */
async function searchDepartments(
  contains: Contains,
  scope: ExtraScope,
): Promise<ExtraResults['departments']> {
  if (!canOpenDepartments(scope.role)) return [];
  const rows = await prisma.department.findMany({
    where: {
      deletedAt: null,
      OR: [{ projectId: null }, { project: scope.project }],
      AND: [{ OR: [{ name: contains }, { key: contains }] }],
    },
    select: { id: true, name: true, key: true, projectId: true },
    orderBy: [{ projectId: 'asc' }, { order: 'asc' }],
    take: EXTRA_LIMITS.departments,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.name, field: 'name' },
      { value: row.key, field: 'code' },
    ]),
  );
}

/**
 * Montages. La plupart n'ont pas de nom — ils sont désignés par ce qu'ils montent : la
 * séquence, ou le projet entier. C'est donc là-dessus que porte la recherche, faute de quoi
 * seuls les montages renommés à la main seraient trouvables.
 */
async function searchTimelines(
  contains: Contains,
  { project }: ExtraScope,
): Promise<ExtraResults['timelines']> {
  const rows = await prisma.timeline.findMany({
    where: {
      project,
      // Un montage de séquence retirée ou masquée ne mène nulle part.
      OR: [{ sequenceId: null }, { sequence: VISIBLE }],
      AND: [
        {
          OR: [
            { name: contains },
            { sequence: { code: contains } },
            { sequence: { name: contains } },
            { project: { name: contains } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      project: { select: { name: true } },
      sequence: { select: { code: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.timelines,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.name, field: 'name' },
      { value: row.sequence?.code, field: 'code' },
      { value: row.project.name, field: 'description' },
    ]),
  ).map((row) => ({
    id: row.id,
    name: row.name,
    projectName: row.project.name,
    sequenceCode: row.sequence?.code ?? null,
  }));
}

/**
 * Boards. Un board n'a pas de nom propre : il est celui d'un projet ou d'un asset, et c'est
 * ce nom-là qu'on tape. Le résultat existe pour la destination — la palette n'offrait
 * jusqu'ici que le board du projet **courant**.
 */
async function searchBoards(contains: Contains, { project }: ExtraScope): Promise<ExtraResults['boards']> {
  const rows = await prisma.board.findMany({
    where: {
      OR: [{ project: { ...project, name: contains } }, { asset: { ...VISIBLE, project, name: contains } }],
    },
    select: {
      id: true,
      projectId: true,
      assetId: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.boards,
  });
  return rankBy(
    rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId,
      name: row.project?.name ?? row.asset?.name ?? '',
    })),
    (row) => bestScore(contains.contains, [{ value: row.name, field: 'name' }]),
  );
}

/** Le porteur d'une fiche : une seule colonne est renseignée (CHECK `EntityNote_target_xor`). */
function holderOf(row: {
  episode: { id: number; code: string } | null;
  sequence: { id: number; code: string } | null;
  shot: { id: number; code: string } | null;
  asset: { id: number; name: string } | null;
}): { holder: BriefHolder; holderId: number; label: string } | null {
  if (row.episode) return { holder: 'episode', holderId: row.episode.id, label: row.episode.code };
  if (row.sequence) return { holder: 'sequence', holderId: row.sequence.id, label: row.sequence.code };
  if (row.shot) return { holder: 'shot', holderId: row.shot.id, label: row.shot.code };
  if (row.asset) return { holder: 'asset', holderId: row.asset.id, label: row.asset.name };
  return null;
}

/**
 * Fiches d'entité (le brief). C'est le seul endroit où vit ce qu'un plan doit devenir, et
 * il n'était cherchable nulle part — pas même depuis la page qui le porte.
 *
 * Recherche par sous-chaîne, contrairement aux notes de review : la fiche est du markdown
 * écrit d'un bloc, sans index plein texte (cf. le compte rendu de phase). L'extrait rendu
 * réutilise le fenêtrage des notes de review, pour que la ligne de palette montre le
 * passage trouvé et non le début du document.
 */
async function searchBriefs(contains: Contains, { project }: ExtraScope): Promise<ExtraResults['briefs']> {
  const rows = await prisma.entityNote.findMany({
    where: {
      body: contains,
      project,
      // Une fiche sans porteur visible n'a pas de page à ouvrir : ce n'est pas un résultat.
      OR: [{ episode: VISIBLE }, { sequence: VISIBLE }, { shot: VISIBLE }, { asset: VISIBLE }],
    },
    select: {
      id: true,
      body: true,
      episode: { select: { id: true, code: true } },
      sequence: { select: { id: true, code: true } },
      shot: { select: { id: true, code: true } },
      asset: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.briefs,
  });
  const tokens = searchTokens(contains.contains);
  const ranked = rankBy(rows, (row) => bestScore(contains.contains, [{ value: row.body, field: 'body' }]));
  return ranked.flatMap((row) => {
    const target = holderOf(row);
    if (!target) return [];
    return [{ id: row.id, ...target, excerpt: excerptAround(row.body, tokens) }];
  });
}

/** Les cinq familles absentes de `searchEntities`, interrogées en parallèle. */
export async function searchExtras(contains: Contains, scope: ExtraScope): Promise<ExtraResults> {
  const [episodes, departments, timelines, boards, briefs] = await Promise.all([
    searchEpisodes(contains, scope),
    searchDepartments(contains, scope),
    searchTimelines(contains, scope),
    searchBoards(contains, scope),
    searchBriefs(contains, scope),
  ]);
  return { episodes, departments, timelines, boards, briefs };
}
