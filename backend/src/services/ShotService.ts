import { AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { softDeleteShot, restoreShot, purgeShot } from '../lib/trash';
import { firstMediaThumbKeyForShot, effectiveThumbnailUrl } from '../lib/thumbnails';
import { logAudit } from './AuditService';
import { badRequest, notFound } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';

/**
 * Logique métier des shots (liste + miniatures, création simple/lot avec unicité de
 * code par séquence, rattachement d'assets, corbeille). L'accès projet (RBAC) est
 * asserté dans la route ; ces fonctions reçoivent des paramètres validés (10.D8).
 */

/** Shots paginés d'un projet (filtre séquence : id, `none` = hors séquence, ou tous) + miniatures. */
export async function list(
  projectId: number,
  seq: number | 'none' | undefined,
  p: PaginationParams,
): Promise<Paginated<unknown>> {
  const seqFilter =
    seq === 'none' ? { sequenceId: null } : seq !== undefined ? { sequenceId: Number(seq) } : {};
  const where = { projectId, deletedAt: null, ...seqFilter };
  const [shots, total] = await Promise.all([
    prisma.shot.findMany({
      where,
      orderBy: { order: 'asc' },
      ...pageArgs(p),
      include: {
        _count: { select: { tasks: true } },
        assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
      },
    }),
    prisma.shot.count({ where }),
  ]);
  const items = await Promise.all(
    shots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, await firstMediaThumbKeyForShot(s.id)),
    })),
  );
  return paginate(items, total, p);
}

/** Vérifie que la séquence (si fournie) appartient bien au projet. */
async function assertSequenceInProject(sequenceId: number | null | undefined, projectId: number) {
  if (!sequenceId) return;
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { projectId: true } });
  if (!seq || seq.projectId !== projectId)
    throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
}

export interface CreateShotInput {
  projectId: number;
  sequenceId?: number | null;
  name: string;
  code: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
}

export async function create(input: CreateShotInput) {
  await assertSequenceInProject(input.sequenceId, input.projectId);
  // Unicité du code par séquence (les shots sans séquence sont un groupe à part).
  const clash = await prisma.shot.findFirst({
    where: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      code: input.code,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (clash) throw badRequest('Un shot avec ce code existe déjà dans cette séquence', 'CODE_TAKEN');
  return prisma.shot.create({
    data: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      name: input.name,
      code: input.code,
      startFrame: input.startFrame ?? null,
      endFrame: input.endFrame ?? null,
      order: input.order ?? 0,
    },
  });
}

export type BulkShotItem = Omit<CreateShotInput, 'projectId'>;

export async function createBulk(projectId: number, items: BulkShotItem[]) {
  // Les séquences référencées doivent appartenir au projet.
  const seqIds = [...new Set(items.map((i) => i.sequenceId).filter((v): v is number => !!v))];
  if (seqIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: seqIds }, projectId } });
    if (ok !== seqIds.length) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
  }
  // Doublons (code, séquence) dans le lot.
  const key = (sid: number | null | undefined, code: string) => `${sid ?? 'none'}::${code}`;
  const keys = items.map((i) => key(i.sequenceId, i.code));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw badRequest(`Code en double dans le lot : ${dup.split('::')[1]}`, 'CODE_DUP');
  // Conflits avec l'existant.
  const existing = await prisma.shot.findMany({
    where: { projectId, deletedAt: null, code: { in: items.map((i) => i.code) } },
    select: { code: true, sequenceId: true },
  });
  const existingKeys = new Set(existing.map((e) => key(e.sequenceId, e.code)));
  const clash = items.find((i) => existingKeys.has(key(i.sequenceId, i.code)));
  if (clash) throw badRequest(`Shot déjà existant dans cette séquence : ${clash.code}`, 'CODE_TAKEN');
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.shot.create({
        data: {
          projectId,
          sequenceId: it.sequenceId ?? null,
          name: it.name,
          code: it.code,
          startFrame: it.startFrame ?? null,
          endFrame: it.endFrame ?? null,
          order: it.order ?? idx,
        },
      }),
    ),
  );
}

/** Détail d'un shot (séquence, tâches, assets). Renvoie aussi projectId pour l'assertion d'accès. */
export async function get(id: number) {
  const shot = await prisma.shot.findUnique({
    where: { id },
    include: {
      sequence: true,
      tasks: { orderBy: { order: 'asc' }, include: { assignee: { select: { id: true, name: true } } } },
      assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
    },
  });
  if (!shot) throw notFound('Shot introuvable');
  return shot;
}

export interface UpdateShotInput {
  sequenceId?: number | null;
  name?: string;
  code?: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
  thumbnailKey?: string | null;
}

export async function update(id: number, projectId: number, body: UpdateShotInput) {
  await assertSequenceInProject(body.sequenceId, projectId);
  // Si le code ou la séquence change, vérifier l'unicité (code unique par séquence).
  if (body.code !== undefined || body.sequenceId !== undefined) {
    const current = await prisma.shot.findUnique({ where: { id }, select: { code: true, sequenceId: true } });
    const nextCode = body.code ?? current!.code;
    const nextSequenceId = body.sequenceId !== undefined ? body.sequenceId : current!.sequenceId;
    const conflict = await prisma.shot.findFirst({
      where: { projectId, sequenceId: nextSequenceId, code: nextCode, deletedAt: null, id: { not: id } },
      select: { id: true },
    });
    if (conflict) throw badRequest('Un shot avec ce code existe déjà dans cette séquence', 'CODE_TAKEN');
  }
  return prisma.shot.update({ where: { id }, data: body });
}

export interface AttachAssetInput {
  assetId?: number;
  name?: string;
  type?: AssetType;
}

/** Rattache un asset existant OU en crée un et le rattache au shot. */
export async function attachAsset(shotId: number, projectId: number, body: AttachAssetInput) {
  let assetId = body.assetId;
  if (assetId === undefined) {
    if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name: body.name! } } }))
      throw badRequest('Un asset avec ce nom existe déjà', 'NAME_TAKEN');
    const created = await prisma.asset.create({
      data: { projectId, name: body.name!, type: body.type ?? AssetType.OTHER },
    });
    assetId = created.id;
  } else {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } });
    if (!asset || asset.projectId !== projectId)
      throw badRequest('Asset invalide pour ce projet', 'BAD_ASSET');
  }
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { connect: { id: assetId } } } });
  return prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true, type: true } });
}

export async function detachAsset(shotId: number, assetId: number) {
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { disconnect: { id: assetId } } } });
}

export async function softDelete(userId: number, id: number) {
  await softDeleteShot(id);
  logAudit({ userId, action: 'SHOT_DELETE', entityType: 'Shot', entityId: id });
}

export async function restore(id: number) {
  await restoreShot(id);
}

export async function purge(userId: number, id: number) {
  await purgeShot(id);
  logAudit({ userId, action: 'SHOT_PURGE', entityType: 'Shot', entityId: id });
}
