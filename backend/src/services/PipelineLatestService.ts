// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { pickMostAdvanced, groupByDepartment, type DepartmentGroup } from '../lib/pipelineOrder';
import { resolveProjectSettingsById, type Department } from '../lib/projectSettings';
import { storage } from './StorageService';

/**
 * « Quelle est la dernière version ? » — la question posée à chaque ouverture d'un asset
 * et à chaque calcul de montage (Phase 45).
 *
 * La règle est celle de `lib/pipelineOrder` : l'étape la plus avancée du pipe qui a
 * quelque chose de visible, puis la plus récente à cette étape. Tout est ici en LOTS
 * (`latestForShots`, `latestForAssets`) : un montage de deux cents plans ne peut pas
 * poser deux cents requêtes, et le tri par pipe se fait en mémoire de toute façon.
 */

/** Un média est visible par l'équipe quand il est publié, prêt, et pas à la corbeille. */
const VISIBLE_MEDIA = { deletedAt: null, published: true, status: MediaStatus.READY } as const;

const mediaSelect = {
  id: true,
  kind: true,
  originalName: true,
  storageKey: true,
  thumbnailKey: true,
  mimeType: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.MediaObjectSelect;

export type LatestMedia = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }>;

/** Version retenue pour une entité, avec sa tâche, son étape et le média à jouer. */
export interface LatestPick {
  versionId: number;
  versionName: string;
  createdAt: Date;
  department: string | null;
  taskId: number | null;
  taskName: string | null;
  media: LatestMedia | null;
  /** Tous les médias visibles de la version (le lecteur en choisit un, l'arbre les liste). */
  allMedia: LatestMedia[];
}

const versionSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  assetId: true,
  author: { select: { id: true, name: true, username: true } },
  reviewStatus: { select: { id: true, name: true, color: true, isApproval: true, isRetake: true } },
  task: { select: { id: true, name: true, department: true, type: true, shotId: true, assetId: true } },
  media: { where: VISIBLE_MEDIA, select: mediaSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.VersionSelect;

type VersionRow = Prisma.VersionGetPayload<{ select: typeof versionSelect }>;

/**
 * Le média à jouer pour une version. La vidéo prime : un montage enchaîne des plans, et
 * une image fixe au milieu d'une séquence n'est un plan que faute de mieux.
 */
function preferPlayable(media: LatestMedia[]): LatestMedia | null {
  return media.find((m) => m.kind === MediaKind.VIDEO) ?? media[0] ?? null;
}

function toPick(row: VersionRow): LatestPick {
  return {
    versionId: row.id,
    versionName: row.name,
    createdAt: row.createdAt,
    department: row.task?.department ?? null,
    taskId: row.task?.id ?? null,
    taskName: row.task?.name ?? null,
    media: preferPlayable(row.media),
    allMedia: row.media,
  };
}

/**
 * Le strict nécessaire à l'élection : rattachement, étape, date, identifiant.
 *
 * L'élection chargeait auparavant la version ENTIÈRE — auteur, statut de review et tous
 * ses médias, `metadata` JSON compris — pour toutes les versions publiées des entités
 * demandées, puis en jetait 90 %. Un montage de deux mille plans à dix versions chacun
 * rapatriait ainsi des dizaines de milliers de lignes pour n'en garder que deux mille.
 */
const candidateSelect = {
  id: true,
  createdAt: true,
  assetId: true,
  task: { select: { department: true, shotId: true, assetId: true } },
} satisfies Prisma.VersionSelect;

type CandidateRow = Prisma.VersionGetPayload<{ select: typeof candidateSelect }>;

/** Prétendants : versions publiées portant au moins un média visible, colonnes minimales. */
function fetchCandidates(where: Prisma.VersionWhereInput): Promise<CandidateRow[]> {
  return prisma.version.findMany({
    where: { ...where, deletedAt: null, published: true, media: { some: VISIBLE_MEDIA } },
    select: candidateSelect,
    orderBy: { createdAt: 'asc' },
  });
}

/** Élit la version la plus avancée de chaque entité parente, sans charger leur contenu. */
function electPerParent(
  rows: CandidateRow[],
  parentOf: (row: CandidateRow) => number | null,
  departments: Department[],
): Map<number, number> {
  const byParent = new Map<number, CandidateRow[]>();
  for (const row of rows) {
    const parent = parentOf(row);
    if (parent === null) continue;
    const list = byParent.get(parent);
    if (list) list.push(row);
    else byParent.set(parent, [row]);
  }
  const out = new Map<number, number>();
  for (const [parent, list] of byParent) {
    const winner = pickMostAdvanced(
      list.map((row) => ({ id: row.id, at: row.createdAt, department: row.task?.department ?? null })),
      departments,
    );
    if (winner) out.set(parent, winner.id);
  }
  return out;
}

/**
 * Charge le contenu des seules versions élues — au plus une par entité — puis le range
 * sous son parent.
 */
async function loadPicks(elected: Map<number, number>): Promise<Map<number, LatestPick>> {
  const out = new Map<number, LatestPick>();
  if (elected.size === 0) return out;
  const rows = await prisma.version.findMany({
    where: { id: { in: [...new Set(elected.values())] } },
    select: versionSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [parent, versionId] of elected) {
    const row = byId.get(versionId);
    if (row) out.set(parent, toPick(row));
  }
  return out;
}

/**
 * Dernière version de chaque shot. `department` restreint la recherche à une étape
 * précise (montage « Layout », montage « Anim »…) ; le repli sur les étapes amont reste
 * assuré, puisqu'on ne filtre alors que le sommet du classement.
 */
export async function latestForShots(
  shotIds: number[],
  departments: Department[],
  department?: string | null,
): Promise<Map<number, LatestPick>> {
  if (shotIds.length === 0) return new Map();
  const rows = await fetchCandidates({ task: { shotId: { in: shotIds } } });
  const kept = department ? withinDepartment(rows, departments, department) : rows;
  return loadPicks(electPerParent(kept, (row) => row.task?.shotId ?? null, departments));
}

/**
 * Restreint aux étapes situées AU PLUS au niveau demandé : demander « Layout » sur un plan
 * déjà en compositing doit montrer le layout, pas le compositing ; demander « Lighting »
 * sur un plan qui n'en a pas encore doit montrer l'animation plutôt qu'un carton vide.
 */
function withinDepartment(
  rows: CandidateRow[],
  departments: Department[],
  department: string,
): CandidateRow[] {
  const ceiling = departments.findIndex((d) => d.key.toLowerCase() === department.toLowerCase());
  if (ceiling < 0) return rows;
  return rows.filter((row) => {
    const rank = departments.findIndex(
      (d) => d.key.toLowerCase() === (row.task?.department ?? '').toLowerCase(),
    );
    return rank >= 0 && rank <= ceiling;
  });
}

/** Dernière version de chaque asset — versions de ses tâches ET versions directes. */
export async function latestForAssets(
  assetIds: number[],
  departments: Department[],
): Promise<Map<number, LatestPick>> {
  if (assetIds.length === 0) return new Map();
  const rows = await fetchCandidates({
    OR: [{ task: { assetId: { in: assetIds } } }, { assetId: { in: assetIds } }],
  });
  return loadPicks(electPerParent(rows, (row) => row.task?.assetId ?? row.assetId, departments));
}

/** Une tâche de l'arbre d'un asset, avec ses versions de la plus récente à la plus ancienne. */
export interface AssetTreeTask {
  id: number | null;
  name: string;
  type: string | null;
  status: string | null;
  /** Statut personnalisable (48) : celui du site ShotGrid sur un projet relié. */
  pipelineStatusId: number | null;
  /** Planification (48) : reprise de ShotGrid quand le projet y est relié. */
  startDate: Date | null;
  dueDate: Date | null;
  department: string | null;
  versions: AssetTreeVersion[];
}

export interface AssetTreeVersion {
  id: number;
  name: string;
  status: string;
  published: boolean;
  createdAt: Date;
  author: { id: number; name: string | null; username: string | null } | null;
  reviewStatus: { id: number; name: string; color: string } | null;
  media: LatestMedia[];
}

/**
 * L'asset vu comme un dossier : départements dans l'ordre du pipe → tâches → versions.
 *
 * Les brouillons sont inclus (l'artiste doit retrouver son travail en cours), mais leurs
 * médias restent filtrés par la visibilité habituelle : `userId` voit les siens, l'équipe
 * voit ce qui est publié. Les versions rattachées directement à l'asset — sans tâche —
 * forment une pseudo-tâche : elles existent en base et personne ne doit les perdre.
 */
export async function assetTree(
  assetId: number,
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  return entityTree({ assetId }, departments, userId);
}

/**
 * Même arbre pour un plan.
 *
 * Un plan traverse ses étapes exactement comme un asset — anim, lighting, compositing —
 * et son travail se lit de la même façon : une carte par tâche, ses versions dessous. Il
 * n'y a aucune raison que les deux écrans divergent, ni deux fois la même requête à
 * écrire. Seule la colonne qui porte le rattachement change.
 */
export async function shotTree(
  shotId: number,
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  return entityTree({ shotId }, departments, userId);
}

async function entityTree(
  parent: { assetId: number } | { shotId: number },
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  const visible = { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] };
  const [tasks, looseVersions] = await Promise.all([
    prisma.task.findMany({
      where: parent,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        pipelineStatusId: true,
        startDate: true,
        dueDate: true,
        department: true,
        versions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { ...versionSelect, published: true, media: { where: visible, select: mediaSelect } },
        },
      },
    }),
    // Versions accrochées directement au parent, sans tâche. Un plan n'en porte jamais
    // (la base ne le permet pas), mais un asset oui : elles existent, personne ne doit
    // les perdre.
    'assetId' in parent
      ? prisma.version.findMany({
          where: { assetId: parent.assetId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { ...versionSelect, published: true, media: { where: visible, select: mediaSelect } },
        })
      : Promise.resolve([]),
  ]);

  const toVersion = (v: (typeof looseVersions)[number]): AssetTreeVersion => ({
    id: v.id,
    name: v.name,
    status: v.status,
    published: v.published,
    createdAt: v.createdAt,
    author: v.author,
    reviewStatus: v.reviewStatus
      ? { id: v.reviewStatus.id, name: v.reviewStatus.name, color: v.reviewStatus.color }
      : null,
    media: v.media,
  });

  const entries: AssetTreeTask[] = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    pipelineStatusId: t.pipelineStatusId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    department: t.department,
    versions: t.versions.map(toVersion),
  }));
  if (looseVersions.length > 0) {
    entries.push({
      id: null,
      name: '',
      type: null,
      pipelineStatusId: null,
      startDate: null,
      dueDate: null,
      status: null,
      department: null,
      versions: looseVersions.map(toVersion),
    });
  }
  return groupByDepartment(entries, departments);
}

/** Média tel qu'il sort de l'API : la clé de stockage reste au serveur, l'URL est signée. */
export interface MediaView {
  id: number;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  createdAt: Date;
  thumbnailUrl: string | null;
}

const toMediaView = async (m: LatestMedia): Promise<MediaView> => ({
  id: m.id,
  kind: m.kind,
  originalName: m.originalName,
  mimeType: m.mimeType,
  createdAt: m.createdAt,
  thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
});

/** Une version telle qu'elle sort de l'API (médias signés). */
export type AssetTreeVersionView = Omit<AssetTreeVersion, 'media'> & { media: MediaView[] };
export type AssetTreeTaskView = Omit<AssetTreeTask, 'versions'> & { versions: AssetTreeVersionView[] };

export interface AssetOverview {
  /** Le pipe du projet, dans l'ordre — l'interface s'en sert pour ses en-têtes. */
  departments: Department[];
  groups: DepartmentGroup<AssetTreeTaskView>[];
  latest: {
    versionId: number;
    versionName: string;
    department: string | null;
    departmentName: string | null;
    taskId: number | null;
    taskName: string | null;
    createdAt: Date;
    media: MediaView | null;
  } | null;
}

/**
 * L'asset tel que l'écran le montre : son pipe, son arbre départements → tâches →
 * versions, et la version qui fait foi. Tout est assemblé ici pour que la route reste
 * une route — et pour qu'un seul endroit décide de ce qu'est « la dernière version ».
 */
export async function assetOverview(assetId: number, userId: number): Promise<AssetOverview> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    select: { projectId: true },
  });
  if (!asset) throw notFound('Asset not found');
  const { departments } = await resolveProjectSettingsById(asset.projectId);

  const [groups, latestMap] = await Promise.all([
    assetTree(assetId, departments, userId),
    latestForAssets([assetId], departments),
  ]);

  const signedGroups = await Promise.all(
    groups.map(async (g) => ({
      ...g,
      items: await Promise.all(
        g.items.map(async (task) => ({
          ...task,
          versions: await Promise.all(
            task.versions.map(async (v) => ({
              ...v,
              media: await Promise.all(v.media.map(toMediaView)),
            })),
          ),
        })),
      ),
    })),
  );

  const pick = latestMap.get(assetId) ?? null;
  const nameOf = (key: string | null) =>
    key ? (departments.find((d) => d.key.toLowerCase() === key.toLowerCase())?.name ?? key) : null;

  return {
    departments,
    groups: signedGroups,
    latest: pick
      ? {
          versionId: pick.versionId,
          versionName: pick.versionName,
          department: pick.department,
          departmentName: nameOf(pick.department),
          taskId: pick.taskId,
          taskName: pick.taskName,
          createdAt: pick.createdAt,
          media: pick.media ? await toMediaView(pick.media) : null,
        }
      : null,
  };
}

/**
 * Le plan vu comme un dossier — pendant exact de `assetOverview`.
 *
 * Un plan et un asset se travaillent de la même façon : des étapes, des tâches, des
 * versions. Leur donner deux écrans différents obligerait l'équipe à apprendre deux fois
 * la même chose, et à nous en tenir deux fois la mécanique à jour.
 */
export async function shotOverview(shotId: number, userId: number): Promise<AssetOverview> {
  const shot = await prisma.shot.findFirst({
    where: { id: shotId, deletedAt: null },
    select: { projectId: true },
  });
  if (!shot) throw notFound('Shot not found');
  const { departments } = await resolveProjectSettingsById(shot.projectId);

  const [groups, latestMap] = await Promise.all([
    shotTree(shotId, departments, userId),
    latestForShots([shotId], departments),
  ]);
  const signedGroups = await Promise.all(
    groups.map(async (g) => ({
      ...g,
      items: await Promise.all(
        g.items.map(async (task) => ({
          ...task,
          versions: await Promise.all(
            task.versions.map(async (v) => ({
              ...v,
              media: await Promise.all(v.media.map(toMediaView)),
            })),
          ),
        })),
      ),
    })),
  );

  const pick = latestMap.get(shotId) ?? null;
  const nameOf = (key: string | null) =>
    key ? (departments.find((d) => d.key.toLowerCase() === key.toLowerCase())?.name ?? key) : null;

  return {
    departments,
    groups: signedGroups,
    latest: pick
      ? {
          versionId: pick.versionId,
          versionName: pick.versionName,
          department: pick.department,
          departmentName: nameOf(pick.department),
          taskId: pick.taskId,
          taskName: pick.taskName,
          createdAt: pick.createdAt,
          media: pick.media ? await toMediaView(pick.media) : null,
        }
      : null,
  };
}
