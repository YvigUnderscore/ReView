// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, Prisma, Role, TaskType, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute, assertProjectManage } from '../lib/projectRoles';
import { parsePipelinePath } from '../lib/pipelinePath';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { sequenceSelect, shotSelect, assetSelect, taskSelect, versionSelect } from '../lib/v1Resources';
import * as DepartmentService from './DepartmentService';
import { emitToProject } from './SocketService';

/**
 * Création idempotente de la structure de pipeline (API v1).
 *
 * « Ensure » plutôt que « create » : un script de publication ne sait pas si le shot
 * existe déjà, et ne devrait pas avoir à le demander avant chaque envoi. Rejouer la même
 * requête doit converger vers le même état, sans doublon ni erreur — c'est ce qui rend
 * l'API utilisable depuis un DCC, où la reprise sur incident est la norme.
 *
 * Les gardes du produit s'appliquent intégralement : projet archivé en lecture seule,
 * CLIENT non contributeur, création de structure réservée aux superviseurs.
 */

type Actor = { id: number; role: Role };

export interface EnsureOutcome<T> {
  entity: T;
  /** L'entité vient-elle d'être créée ? Permet au client de distinguer reprise et primo-envoi. */
  created: boolean;
}

const insensitive = (value: string) => ({ equals: value, mode: 'insensitive' as const });

/**
 * Rattrape une violation d'unicité survenue malgré la recherche préalable. Deux causes :
 * une requête concurrente vient de créer l'entité (on la renvoie, `created: false`), ou le
 * nom est retenu par une entité de la corbeille — la contrainte SQL ignore le soft-delete.
 * Dans ce second cas on répond 409 avec un code nommé, jamais une erreur interne.
 */
async function recoverUniqueViolation<T>(
  err: unknown,
  refind: () => Promise<T | null>,
  trashConflict: () => Error,
): Promise<EnsureOutcome<T>> {
  if (!isUniqueViolation(err)) throw err;
  const winner = await refind();
  if (winner) return { entity: winner, created: false };
  throw trashConflict();
}

/** Violation d'un index d'unicité (P2002), par opposition à une panne à laisser remonter. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Créer de la structure (séquence, shot, asset) engage la production : superviseur+. */
async function assertCanCreateStructure(actor: Actor, projectId: number): Promise<void> {
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);
}

/** Créer une tâche ou une version relève du travail courant : contributeur suffit. */
async function assertCanCreateWork(actor: Actor, projectId: number): Promise<void> {
  await assertProjectWritable(projectId);
  await assertCanContribute(actor.id, actor.role, projectId);
}

export interface EnsureSequenceInput {
  code: string;
  name?: string;
  order?: number;
}

export async function ensureSequence(actor: Actor, projectId: number, input: EnsureSequenceInput) {
  const find = () =>
    prisma.sequence.findFirst({
      where: { projectId, deletedAt: null, code: insensitive(input.code) },
      select: sequenceSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.sequence.create({
      data: {
        projectId,
        code: input.code,
        name: input.name ?? input.code,
        order: input.order ?? 0,
      },
      select: sequenceSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`Sequence « ${input.code} » is in the trash`, 'SEQUENCE_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'sequence:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureShotInput {
  code: string;
  name?: string;
  sequenceCode?: string;
  startFrame?: number;
  endFrame?: number;
  order?: number;
}

export async function ensureShot(actor: Actor, projectId: number, input: EnsureShotInput) {
  // La séquence parente est créée au besoin : publier un shot d'une séquence inconnue est
  // le cas normal en début de production, pas une erreur à faire remonter à l'artiste.
  let sequenceId: number | null = null;
  if (input.sequenceCode) {
    const seq = await ensureSequence(actor, projectId, { code: input.sequenceCode });
    sequenceId = seq.entity.id;
  }

  const find = () =>
    prisma.shot.findFirst({
      where: { projectId, deletedAt: null, sequenceId, code: insensitive(input.code) },
      select: shotSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.shot.create({
      data: {
        projectId,
        sequenceId,
        code: input.code,
        name: input.name ?? input.code,
        startFrame: input.startFrame ?? null,
        endFrame: input.endFrame ?? null,
        order: input.order ?? 0,
      },
      select: shotSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`Shot « ${input.code} » is in the trash`, 'SHOT_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'shot:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureAssetInput {
  name: string;
  type?: AssetType;
  description?: string;
}

export async function ensureAsset(actor: Actor, projectId: number, input: EnsureAssetInput) {
  const find = () =>
    prisma.asset.findFirst({
      where: { projectId, deletedAt: null, name: insensitive(input.name) },
      select: assetSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.asset.create({
      data: {
        projectId,
        name: input.name,
        type: input.type ?? AssetType.OTHER,
        description: input.description ?? null,
      },
      select: assetSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`L'asset « ${input.name} » is in the trash`, 'ASSET_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'asset:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureTaskInput {
  name: string;
  type?: TaskType;
  /** Département du pipe (clé). Déduit du nom de la tâche s'il n'est pas fourni. */
  department?: string;
}

/** Tâche rattachée à un shot XOR un asset. */
export async function ensureTask(
  actor: Actor,
  projectId: number,
  parent: { shotId?: number; assetId?: number },
  input: EnsureTaskInput,
) {
  if ((parent.shotId === undefined) === (parent.assetId === undefined)) {
    throw badRequest('Provide exactly one parent: a shot or an asset');
  }
  const parentWhere = parent.shotId !== undefined ? { shotId: parent.shotId } : { assetId: parent.assetId };
  const { department, departmentId } = await resolveTaskDepartment(projectId, input);

  // Le département fait partie de l'identité de la tâche : `modeling:main` et
  // `lookdev:main` cohabitent, et rejouer une publication doit retrouver la bonne.
  // La relation ET la clé sont interrogées : les tâches d'avant le rattrapage n'ont que
  // la seconde, et ne pas les voir ferait un doublon à chaque publication.
  const find = () =>
    prisma.task.findFirst({
      where: { ...parentWhere, name: insensitive(input.name), ...departmentWhere(department, departmentId) },
      select: taskSelect,
    });
  const existing = await find();
  if (existing) {
    if (departmentId !== null) await healTaskDepartment(existing.id, departmentId);
    return { entity: existing, created: false };
  }

  await assertCanCreateWork(actor, projectId);
  let entity;
  try {
    entity = await prisma.task.create({
      data: {
        ...parentWhere,
        name: input.name,
        type: input.type ?? inferTaskType(input.name),
        department,
        departmentId,
      },
      select: taskSelect,
    });
  } catch (err) {
    // Deux publications simultanées de la même ferme de rendu : la seconde perd la course
    // et récupère la tâche que la première vient de créer, au lieu d'en faire une jumelle.
    return recoverUniqueViolation(err, find, () =>
      conflict(`Task « ${input.name} » already exists`, 'TASK_EXISTS'),
    );
  }
  emitToProject(projectId, 'task:update', { projectId, id: entity.id });
  return { entity, created: true };
}

/** Critère de département d'une recherche de tâche : la relation, ou la clé, ou rien. */
function departmentWhere(department: string | null, departmentId: number | null) {
  if (departmentId !== null && department)
    return { OR: [{ departmentId }, { department: insensitive(department) }] };
  return department ? { department: insensitive(department) } : {};
}

/**
 * Rattache au passage une tâche que la publication d'avant n'avait reliée que par sa clé.
 * Le filtre `departmentId: null` fait de l'écriture un non-événement dans le cas courant :
 * aucune ligne ne correspond, `updatedAt` ne bouge pas.
 */
async function healTaskDepartment(taskId: number, departmentId: number): Promise<void> {
  await prisma.task.updateMany({ where: { id: taskId, departmentId: null }, data: { departmentId } });
}

/**
 * Département d'une tâche à créer : la clé dénormalisée ET la relation (B1).
 *
 * Une clé fournie par le client est *déclarée* — elle crée l'étape si le projet ne la
 * connaît pas encore, comme le fait l'import ShotGrid. Une clé simplement *devinée* depuis
 * le nom de la tâche, non : elle ne se pose que si l'étape existe déjà, faute de quoi une
 * heuristique enrichirait le pipe du studio. Sans elle, en revanche, les publications DCC
 * rempliraient le fourre-tout « sans département » et fausseraient l'étape la plus avancée.
 */
async function resolveTaskDepartment(
  projectId: number,
  input: EnsureTaskInput,
): Promise<DepartmentService.TaskDepartment> {
  if (input.department) return DepartmentService.resolveForTask(projectId, input.department);
  const guessed = input.type ?? inferTaskType(input.name);
  if (guessed === TaskType.OTHER) return { department: null, departmentId: null };
  const found = await DepartmentService.findByKey(projectId, guessed);
  if (found) return { department: found.key, departmentId: found.id };
  // Repli sur les réglages : une base dont les départements ne sont pas encore des
  // entités continue d'écrire la clé, même sans relation à poser.
  const { departments } = await resolveProjectSettingsById(projectId);
  const match = departments.find((d) => d.key.toLowerCase() === guessed.toLowerCase());
  return { department: match?.key ?? null, departmentId: null };
}

/**
 * Devine le type d'une tâche depuis son nom (`anim` → ANIMATION). Les noms de tâches sont
 * très standardisés en production ; laisser tout en OTHER dégraderait les filtres et les
 * statistiques pour les clients qui n'envoient pas le type.
 */
export function inferTaskType(name: string): TaskType {
  const n = name.toLowerCase();
  const table: [RegExp, TaskType][] = [
    [/^(anim|animation)/, TaskType.ANIMATION],
    [/^(model|modeling|modelling|mod)/, TaskType.MODELING],
    [/^(rig|rigging)/, TaskType.RIGGING],
    [/^(fx|effects|vfx)/, TaskType.FX],
    [/^(light|lighting|lgt)/, TaskType.LIGHTING],
    [/^(comp|compositing)/, TaskType.COMPOSITING],
    [/^(look|lookdev|shading|surf)/, TaskType.LOOKDEV],
    [/^(layout|lay|blocking)/, TaskType.LAYOUT],
  ];
  return table.find(([re]) => re.test(n))?.[1] ?? TaskType.OTHER;
}

export interface EnsureVersionInput {
  /** Nom explicite (`v003`). Absent : la version suivante est calculée. */
  name?: string;
  /** Réutiliser une version existante de même nom plutôt que d'échouer. */
  reuseExisting?: boolean;
}

/**
 * Version rattachée à une tâche XOR un asset. Sans nom fourni, le numéro suivant est
 * calculé (V01, V02…) — deux publications successives ne s'écrasent jamais.
 */
export async function ensureVersion(
  actor: Actor,
  projectId: number,
  parent: { taskId?: number; assetId?: number },
  input: EnsureVersionInput = {},
) {
  if ((parent.taskId === undefined) === (parent.assetId === undefined)) {
    throw badRequest('Provide exactly one parent: a task or an asset');
  }
  const parentWhere = parent.taskId !== undefined ? { taskId: parent.taskId } : { assetId: parent.assetId };
  const find = (name: string) =>
    prisma.version.findFirst({
      where: { ...parentWhere, deletedAt: null, name: insensitive(name) },
      select: versionSelect,
    });

  if (input.name) {
    const existing = await find(input.name);
    if (existing) {
      if (input.reuseExisting) return { entity: existing, created: false };
      throw badRequest(`Version « ${input.name} » already exists`, 'VERSION_EXISTS');
    }
  }

  await assertCanCreateWork(actor, projectId);
  const create = (name: string) =>
    prisma.version.create({
      data: { ...parentWhere, name, authorId: actor.id, status: VersionStatus.DRAFT },
      select: versionSelect,
    });

  let entity;
  if (input.name) {
    try {
      entity = await create(input.name);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Le nom est pris depuis la recherche : soit par une publication concurrente, soit
      // par une version en corbeille — l'index d'unicité, lui, ignore le soft-delete.
      const winner = await find(input.name);
      if (!winner) throw conflict(`Version « ${input.name} » is in the trash`, 'VERSION_IN_TRASH');
      if (input.reuseExisting) return { entity: winner, created: false };
      throw badRequest(`Version « ${input.name} » already exists`, 'VERSION_EXISTS');
    }
  } else {
    entity = await createNextVersion(parentWhere, create);
  }
  emitToProject(projectId, 'version:update', {
    projectId,
    id: entity.id,
    taskId: parent.taskId ?? null,
    assetId: parent.assetId ?? null,
  });
  return { entity, created: true };
}

/**
 * Version suivante, en tenant compte des publications concurrentes.
 *
 * Le numéro se calcule hors transaction : deux publications simultanées visent la même
 * V03, et l'une des deux perd la course. Lui rendre la version de l'autre serait le pire
 * des dénouements — son média se rattacherait au travail d'un collègue. On recalcule donc
 * le numéro et on retente : c'est bien « la version suivante » qui a été demandée.
 */
async function createNextVersion<T>(
  parentWhere: { taskId?: number; assetId?: number },
  create: (name: string) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const name = await nextVersionName(parentWhere);
    try {
      return await create(name);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (attempt >= attempts) throw conflict('Could not allocate a version number', 'VERSION_RACE');
    }
  }
}

/**
 * Prochain nom de version. On repart du plus grand numéro *existant* et non du nombre de
 * versions : après une suppression, compter donnerait un nom déjà pris.
 */
async function nextVersionName(parentWhere: { taskId?: number; assetId?: number }): Promise<string> {
  const versions = await prisma.version.findMany({ where: parentWhere, select: { name: true } });
  const highest = versions.reduce((max, v) => {
    const n = Number(/(\d+)\s*$/.exec(v.name)?.[1] ?? 0);
    return n > max ? n : max;
  }, 0);
  return `V${String(highest + 1).padStart(2, '0')}`;
}

export interface EnsurePathOptions {
  shot?: Omit<EnsureShotInput, 'code'>;
  asset?: Omit<EnsureAssetInput, 'name'>;
  task?: Omit<EnsureTaskInput, 'name'>;
  version?: EnsureVersionInput;
}

/**
 * Crée toute la chaîne décrite par un chemin (`PROJ/SQ010/SH0100/anim/v003`), en ne
 * touchant que ce qui manque. Le projet, lui, n'est jamais créé implicitement : ouvrir un
 * film est une décision de production, pas l'effet de bord d'un script mal paramétré.
 */
export async function ensurePath(
  actor: Actor,
  projectId: number,
  rawPath: string,
  opts: EnsurePathOptions = {},
) {
  const parsed = parsePipelinePath(rawPath);
  const created: string[] = [];
  const out: {
    sequenceId?: number;
    shotId?: number;
    assetId?: number;
    taskId?: number;
    versionId?: number;
    created: string[];
  } = { created };

  if (parsed.asset) {
    const asset = await ensureAsset(actor, projectId, { name: parsed.asset, ...opts.asset });
    out.assetId = asset.entity.id;
    if (asset.created) created.push('asset');
  } else {
    if (parsed.sequence) {
      const seq = await ensureSequence(actor, projectId, { code: parsed.sequence });
      out.sequenceId = seq.entity.id;
      if (seq.created) created.push('sequence');
    }
    if (parsed.shot) {
      const shot = await ensureShot(actor, projectId, {
        code: parsed.shot,
        sequenceCode: parsed.sequence,
        ...opts.shot,
      });
      out.shotId = shot.entity.id;
      if (shot.created) created.push('shot');
    }
  }

  if (parsed.task) {
    const parent = out.shotId !== undefined ? { shotId: out.shotId } : { assetId: out.assetId };
    // Le département du chemin (`layout:main`) ne cède qu'à une valeur explicitement
    // passée en option par l'appelant.
    const task = await ensureTask(actor, projectId, parent, {
      name: parsed.task,
      department: parsed.department,
      ...opts.task,
    });
    out.taskId = task.entity.id;
    if (task.created) created.push('task');
  }

  if (parsed.version) {
    const parent = out.taskId !== undefined ? { taskId: out.taskId } : { assetId: out.assetId };
    const version = await ensureVersion(actor, projectId, parent, {
      name: parsed.version,
      ...opts.version,
    });
    out.versionId = version.entity.id;
    if (version.created) created.push('version');
  }

  return out;
}
