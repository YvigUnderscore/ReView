// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, type Department } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';

/**
 * Départements du pipeline (B1).
 *
 * Un département était une entrée d'un tableau JSON dans les réglages : rien ne garantissait
 * qu'une tâche pointe vers une étape existante, et renommer une clé détachait en silence
 * tout ce qui s'y rattachait. C'est maintenant une entité, avec deux portées :
 *
 * - **studio** (`projectId = null`) : le pipe par défaut, hérité par tous les projets ;
 * - **projet** : la liste propre d'un projet, qui remplace entièrement celle du studio.
 *
 * Le remplacement est volontairement total, non fusionné : un projet qui redéfinit son pipe
 * le redéfinit vraiment, sinon on ne saurait plus dire d'où vient une étape ni comment
 * l'en retirer.
 */

export interface DepartmentInput {
  key?: string;
  name: string;
  order?: number;
  color?: string | null;
}

/** Entités qui peuvent déclarer les départements qu'elles traversent. */
export type DepartmentHolder = 'asset' | 'shot' | 'sequence';

const ORDER_BY = [{ order: 'asc' as const }, { key: 'asc' as const }];

/** Départements du studio, hérités par les projets qui n'en redéfinissent pas. */
export async function listForStudio(studioId: number): Promise<Department[]> {
  return prisma.department.findMany({
    where: { studioId, projectId: null, deletedAt: null },
    orderBy: ORDER_BY,
  });
}

/**
 * Départements applicables à un projet : les siens s'il en a, sinon ceux du studio.
 * C'est cette liste que lit le pipe (`lib/pipelineOrder.ts`) pour ordonner les étapes.
 */
export async function listForProject(projectId: number): Promise<Department[]> {
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    orderBy: ORDER_BY,
  });
  if (own.length > 0) return own;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return [];
  return listForStudio(project.studioId);
}

/**
 * Clé stable dérivée du nom. Immuable après création : c'est elle que portent les tâches,
 * les timelines et les snapshots de montage.
 */
export function normaliseKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export async function create(
  studioId: number,
  projectId: number | null,
  input: DepartmentInput,
): Promise<Department> {
  const key = normaliseKey(input.key ?? input.name);
  if (!key) throw badRequest('Department name cannot be empty');
  const existing = await prisma.department.findFirst({
    where: projectId === null ? { studioId, projectId: null, key } : { projectId, key },
  });
  if (existing) {
    // Ressusciter plutôt que refuser : supprimer puis recréer une étape est un geste
    // courant, et la clé doit rester la même pour que les tâches d'avant se retrouvent.
    if (existing.deletedAt)
      return prisma.department.update({
        where: { id: existing.id },
        data: { deletedAt: null, name: input.name, order: input.order ?? existing.order },
      });
    throw conflict('A department already uses this key');
  }
  return prisma.department.create({
    data: {
      studioId,
      projectId,
      key,
      name: input.name.trim(),
      order: input.order ?? (await nextOrder(studioId, projectId)),
      color: input.color ?? null,
    },
  });
}

/** Le nom, l'ordre et la couleur se modifient ; la clé, jamais. */
export async function update(id: number, input: Partial<DepartmentInput>): Promise<Department> {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department not found');
  return prisma.department.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });
}

/**
 * Retrait d'un département. Les tâches qui le portaient gardent leur clé dénormalisée et
 * repassent simplement en fin de pipe : rien n'est perdu, et rétablir le département les
 * y ramène. C'est un retrait logique, jamais une suppression de travail.
 */
export async function remove(id: number): Promise<void> {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department not found');
  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function reorder(ids: number[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, index) => prisma.department.update({ where: { id }, data: { order: index } })),
  );
}

/**
 * Départements que déclare traverser une entité. Remplace la liste entière — l'appelant
 * envoie l'état voulu, pas un delta.
 */
/**
 * Le projet auquel appartient l'entité porteuse. Sans lui, aucun contrôle n'est possible :
 * un identifiant de département suffisait à rattacher l'étape d'un autre projet.
 */
export async function holderProjectId(holder: DepartmentHolder, id: number): Promise<number> {
  const row =
    holder === 'asset'
      ? await prisma.asset.findUnique({ where: { id }, select: { projectId: true } })
      : holder === 'shot'
        ? await prisma.shot.findUnique({ where: { id }, select: { projectId: true } })
        : await prisma.sequence.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw notFound('Entity not found');
  return row.projectId;
}

/**
 * Vérifie que chaque département appartient bien au vocabulaire de ce projet.
 *
 * Le rattachement ne le vérifiait pas du tout : un identifiant pris ailleurs — l'étape
 * d'un autre projet, ou une étape supprimée — se posait sans broncher, et l'entité se
 * retrouvait dans un pipe qui n'était pas le sien.
 */
export async function assertDepartmentsOfProject(projectId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { studioId: true },
  });
  if (!project) throw notFound('Project not found');
  /**
   * Le projet **et** le studio.
   *
   * `listForProject` sert à *proposer* une liste — un projet qui déclare ses propres
   * étapes remplace celles du studio dans les menus. Mais il ne les rend pas illégitimes
   * pour autant : les tâches déjà en base vivent souvent dans une étape du studio, et
   * les refuser ici empêcherait d'assigner du travail sur ces tâches-là. Ce qu'on
   * interdit, c'est l'étape d'un **autre projet** — celle-là ne se rattrape pas.
   */
  const allowed = await prisma.department.findMany({
    where: {
      deletedAt: null,
      studioId: project.studioId,
      OR: [{ projectId }, { projectId: null }],
    },
    select: { id: true },
  });
  const known = new Set(allowed.map((d) => d.id));
  const stranger = ids.find((id) => !known.has(id));
  if (stranger !== undefined) throw badRequest('Unknown department for this project', 'BAD_DEPARTMENT');
}

async function writeHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departments: Prisma.AssetUpdateInput['departments'],
): Promise<void> {
  if (holder === 'asset') await prisma.asset.update({ where: { id }, data: { departments } });
  else if (holder === 'shot') await prisma.shot.update({ where: { id }, data: { departments } });
  else await prisma.sequence.update({ where: { id }, data: { departments } });
}

export async function setHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  await assertDepartmentsOfProject(await holderProjectId(holder, id), departmentIds);
  await writeHolderDepartments(holder, id, {
    set: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** Ajoute des départements sans toucher aux autres — idempotent. */
export async function attachHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  if (departmentIds.length === 0) return;
  await assertDepartmentsOfProject(await holderProjectId(holder, id), departmentIds);
  await writeHolderDepartments(holder, id, {
    connect: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** Retire des départements sans toucher aux autres — idempotent. */
export async function detachHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  if (departmentIds.length === 0) return;
  await writeHolderDepartments(holder, id, {
    disconnect: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** Départements d'une personne (annuaire studio). */
export async function setUserDepartments(userId: number, departmentIds: number[]): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { departments: { set: departmentIds.map((id) => ({ id })) } },
  });
}

/**
 * Département portant cette clé, sans le créer. Deux portées sont fouillées, dans cet
 * ordre : celle du projet, puis celle du studio.
 *
 * `listForProject` ne convient pas ici : elle *propose* une liste, et masque le
 * référentiel du studio dès que le projet en a un. Or une tâche déjà en base porte
 * souvent une étape du studio — c'est le même raisonnement que
 * `assertDepartmentsOfProject` : ce qu'on refuse, c'est l'étape d'un AUTRE projet.
 *
 * La comparaison ignore la casse et la ponctuation : le site distant envoie
 * « Look Development » là où la base porte `LOOK_DEV`, et les clés reprises par la
 * migration de rattrapage n'ont pas toutes été normalisées.
 */
export async function findByKey(projectId: number, key: string): Promise<Department | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return null;
  const candidates = await prisma.department.findMany({
    where: { deletedAt: null, studioId: project.studioId, OR: [{ projectId }, { projectId: null }] },
    orderBy: ORDER_BY,
  });
  const needle = trimmed.toLowerCase();
  const normalised = normaliseKey(trimmed);
  const matches = (d: Department) =>
    d.key.toLowerCase() === needle || (normalised !== '' && normaliseKey(d.key) === normalised);
  return (
    candidates.find((d) => d.projectId === projectId && matches(d)) ??
    candidates.find((d) => d.projectId === null && matches(d)) ??
    null
  );
}

/**
 * Résout un département par sa clé, dans le vocabulaire du projet. Sert au rattachement
 * d'une tâche quand l'appelant ne connaît que la clé — l'import ShotGrid, notamment.
 * Crée l'étape manquante au niveau du projet plutôt que de la perdre : une étape venue du
 * site distant existe, même si le studio ne l'a pas déclarée.
 */
export async function resolveByKey(projectId: number, key: string): Promise<Department | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const found = await findByKey(projectId, trimmed);
  if (found) return found;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return null;
  await materialiseInheritance(project.studioId, projectId);
  try {
    return await create(project.studioId, projectId, { key: trimmed, name: trimmed, order: 900 });
  } catch (err) {
    // Deux publications simultanées portant la même étape inconnue : la seconde perd la
    // course contre l'index d'unicité. C'est le résultat attendu qui compte, pas qui a
    // écrit — on relit ce que l'autre vient de poser.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    return findByKey(projectId, trimmed);
  }
}

/**
 * Fige l'héritage avant d'ajouter une étape au projet.
 *
 * Un projet sans liste propre hérite de celle du studio ; lui poser UNE étape ne l'ajoute
 * pas à la liste héritée, elle la remplace tout entière (`listForProject` s'arrête à la
 * première liste non vide). Un `step` importé suffisait donc à réduire le pipe d'un projet
 * à une seule ligne, et à faire disparaître des menus les huit étapes qu'il affichait la
 * minute d'avant. On recopie donc l'héritage à la portée projet, puis on complète.
 *
 * Le projet cesse alors de suivre les évolutions du studio — c'est le prix, et il est
 * réversible : retirer ses étapes propres lui rend l'héritage.
 */
async function materialiseInheritance(studioId: number, projectId: number): Promise<void> {
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true },
  });
  if (own.length > 0) return;
  const inherited = await listForStudio(studioId);
  if (inherited.length === 0) return;
  await prisma.department.createMany({
    data: inherited.map((d) => ({
      studioId,
      projectId,
      key: d.key,
      name: d.name,
      order: d.order,
      color: d.color,
    })),
    skipDuplicates: true,
  });
  // Une étape que le projet portait en corbeille garde la clé (l'index d'unicité ignore le
  // soft-delete) : la copie ci-dessus l'a sautée, on la relève pour que la liste figée soit
  // bien celle qui était affichée.
  await prisma.department.updateMany({
    where: { projectId, deletedAt: { not: null }, key: { in: inherited.map((d) => d.key) } },
    data: { deletedAt: null },
  });
}

/** Ce que porte une tâche : la clé dénormalisée ET la relation (B1). */
export interface TaskDepartment {
  department: string | null;
  departmentId: number | null;
}

/**
 * Couple `{department, departmentId}` à écrire sur une tâche, depuis une clé quelconque.
 *
 * Tous les chemins d'écriture passent par ici — interface, publication DCC, import
 * ShotGrid — pour que la relation ne soit plus le privilège de l'un d'eux : une tâche dont
 * seule la chaîne est renseignée est invisible à l'assignation par département.
 *
 * `create: false` interdit la création : c'est la politique appliquée aux clés *devinées*
 * (le type déduit du nom d'une tâche). Une devinette n'a pas à enrichir le pipe d'un
 * studio ; une étape explicitement nommée par un DCC ou par le site distant, si.
 */
export async function resolveForTask(
  projectId: number,
  key: string | null | undefined,
  options: { create?: boolean } = {},
): Promise<TaskDepartment> {
  const trimmed = key?.trim();
  if (!trimmed) return { department: null, departmentId: null };
  const found =
    options.create === false ? await findByKey(projectId, trimmed) : await resolveByKey(projectId, trimmed);
  // Étape introuvable et création refusée : la clé reste écrite telle quelle plutôt que
  // perdue — elle porte l'ordre du pipe et le nommage des versions.
  return found
    ? { department: found.key, departmentId: found.id }
    : { department: trimmed, departmentId: null };
}

/**
 * Aligne les départements d'un projet sur la liste éditée dans ses réglages (B1).
 *
 * L'écran de réglages manipule toujours une liste ordonnée de `{key, name}` — c'est la
 * forme la plus lisible pour un pipe. Cette fonction la traduit en entités : elle crée ce
 * qui manque, renomme et réordonne ce qui existe, et retire logiquement le reste. Sans
 * elle, l'éditeur écrirait dans un JSON que plus personne ne lit.
 *
 * La clé identifie : la renommer revient à retirer une étape et à en ajouter une autre —
 * c'est précisément ce qu'on veut, plutôt que le détachement silencieux d'avant.
 */
export async function syncFromSettings(
  projectId: number,
  wanted: { key: string; name: string }[],
): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return;
  const current = await listForProject(projectId);
  // Une liste identique à celle du studio n'a pas à être recopiée dans le projet : il
  // continue d'hériter, et suivra les évolutions du référentiel.
  const sameAsInherited =
    current.every((d) => d.projectId === null) &&
    current.length === wanted.length &&
    current.every((d, i) => d.key === normaliseKey(wanted[i]!.key) && d.name === wanted[i]!.name.trim());
  if (sameAsInherited) return;

  const own = await prisma.department.findMany({ where: { projectId } });
  const byKey = new Map(own.map((d) => [d.key.toLowerCase(), d]));
  const keptIds = new Set<number>();

  for (const [index, entry] of wanted.entries()) {
    const key = normaliseKey(entry.key || entry.name);
    if (!key) continue;
    const existing = byKey.get(key.toLowerCase());
    if (existing) {
      keptIds.add(existing.id);
      await prisma.department.update({
        where: { id: existing.id },
        data: { name: entry.name.trim() || key, order: index, deletedAt: null },
      });
      continue;
    }
    const created = await prisma.department.create({
      data: { studioId: project.studioId, projectId, key, name: entry.name.trim() || key, order: index },
    });
    keptIds.add(created.id);
  }

  const removed = own.filter((d) => !keptIds.has(d.id) && !d.deletedAt);
  if (removed.length > 0)
    await prisma.department.updateMany({
      where: { id: { in: removed.map((d) => d.id) } },
      data: { deletedAt: new Date() },
    });
}

async function nextOrder(studioId: number, projectId: number | null): Promise<number> {
  const last = await prisma.department.findFirst({
    where: projectId === null ? { studioId, projectId: null } : { projectId },
    orderBy: { order: 'desc' },
  });
  return (last?.order ?? -1) + 1;
}
