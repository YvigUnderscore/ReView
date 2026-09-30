// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';

/**
 * Résolution du contexte (fil d'Ariane) d'une entité du pipeline :
 * chaîne d'ancêtres Projet → Séquence → Shot | Asset → Tâche → Version → Média
 * en UNE requête Prisma (includes imbriqués). Sert le breadcrumb global de l'UI.
 */

export type ContextEntity = 'media' | 'version' | 'task' | 'shot' | 'sequence' | 'asset' | 'project';

export interface BreadcrumbContext {
  project: { id: number; name: string };
  sequence?: { id: number; code: string; name: string } | null;
  shot?: { id: number; code: string; name: string } | null;
  asset?: { id: number; name: string; type: string } | null;
  task?: { id: number; name: string; type: string } | null;
  version?: { id: number; name: string } | null;
  media?: { id: number; originalName: string; kind: string } | null;
}

const seqSel = { select: { id: true, code: true, name: true, deletedAt: true } } as const;
const projSel = { select: { id: true, name: true, deletedAt: true } } as const;
const shotInc = { include: { sequence: seqSel, project: projSel } } as const;
const assetInc = { include: { project: projSel } } as const;
const taskInc = { include: { shot: shotInc, asset: assetInc } } as const;
const versionInc = { include: { task: taskInc, asset: assetInc } } as const;

type ProjRow = { id: number; name: string; deletedAt: Date | null };
type SeqRow = { id: number; code: string; name: string; deletedAt: Date | null };
type ShotRow = {
  id: number;
  code: string;
  name: string;
  deletedAt: Date | null;
  sequence: SeqRow | null;
  project: ProjRow;
};
type AssetRow = { id: number; name: string; type: string; deletedAt: Date | null; project: ProjRow };
type TaskRow = { id: number; name: string; type: string; shot: ShotRow | null; asset: AssetRow | null };
type VersionRow = {
  id: number;
  name: string;
  deletedAt: Date | null;
  task: TaskRow | null;
  asset: AssetRow | null;
};

function fromProject(p: ProjRow | null): BreadcrumbContext | null {
  if (!p || p.deletedAt) return null;
  return { project: { id: p.id, name: p.name } };
}

function fromShot(s: ShotRow | null): BreadcrumbContext | null {
  const base = s ? fromProject(s.project) : null;
  if (!s || s.deletedAt || !base) return null;
  return {
    ...base,
    sequence:
      s.sequence && !s.sequence.deletedAt
        ? { id: s.sequence.id, code: s.sequence.code, name: s.sequence.name }
        : null,
    shot: { id: s.id, code: s.code, name: s.name },
  };
}

function fromAsset(a: AssetRow | null): BreadcrumbContext | null {
  const base = a ? fromProject(a.project) : null;
  if (!a || a.deletedAt || !base) return null;
  return { ...base, asset: { id: a.id, name: a.name, type: a.type } };
}

function fromTask(t: TaskRow | null): BreadcrumbContext | null {
  if (!t) return null;
  const base = t.shot ? fromShot(t.shot) : fromAsset(t.asset);
  if (!base) return null;
  return { ...base, task: { id: t.id, name: t.name, type: t.type } };
}

function fromVersion(v: VersionRow | null): BreadcrumbContext | null {
  if (!v || v.deletedAt) return null;
  const base = v.task ? fromTask(v.task) : fromAsset(v.asset);
  if (!base) return null;
  return { ...base, version: { id: v.id, name: v.name } };
}

/** Résout le contexte d'une entité ; `null` si introuvable ou à la corbeille. */
export async function resolveContext(entity: ContextEntity, id: number): Promise<BreadcrumbContext | null> {
  switch (entity) {
    case 'project':
      return fromProject(await prisma.project.findUnique({ where: { id }, ...projSel }));
    case 'sequence': {
      const s = await prisma.sequence.findUnique({ where: { id }, include: { project: projSel } });
      const base = s && !s.deletedAt ? fromProject(s.project) : null;
      return base ? { ...base, sequence: { id: s!.id, code: s!.code, name: s!.name } } : null;
    }
    case 'shot':
      return fromShot(await prisma.shot.findUnique({ where: { id }, ...shotInc }));
    case 'asset':
      return fromAsset(await prisma.asset.findUnique({ where: { id }, ...assetInc }));
    case 'task':
      return fromTask(await prisma.task.findUnique({ where: { id }, ...taskInc }));
    case 'version':
      return fromVersion(await prisma.version.findUnique({ where: { id }, ...versionInc }));
    case 'media': {
      const m = await prisma.mediaObject.findUnique({
        where: { id },
        include: { version: versionInc },
      });
      if (!m || m.deletedAt) return null;
      const base = fromVersion(m.version);
      if (!base) return null;
      return { ...base, media: { id: m.id, originalName: m.originalName, kind: m.kind } };
    }
  }
}
