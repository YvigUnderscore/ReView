import { Role, Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Recherche globale multi-entités (palette Ctrl+K).
 * RBAC : admin/superviseur voient tout ; sinon filtre par membership projet.
 * Corbeille exclue partout. Max 5 résultats par type.
 */

const MAX_PER_TYPE = 5;

export interface SearchResults {
  projects: { id: number; name: string }[];
  sequences: { id: number; code: string; name: string; projectId: number }[];
  shots: { id: number; code: string; name: string; projectId: number }[];
  assets: { id: number; name: string; type: string; projectId: number }[];
  tasks: { id: number; name: string; type: string; shotId: number | null; assetId: number | null }[];
}

export async function searchEntities(q: string, userId: number, role: Role): Promise<SearchResults> {
  const isGlobal = role === Role.ADMIN || role === Role.SUPERVISOR;
  const projectAccess: Prisma.ProjectWhereInput = isGlobal
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId } } };
  const contains = { contains: q, mode: 'insensitive' as const };

  const [projects, sequences, shots, assets, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectAccess, name: contains },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PER_TYPE,
    }),
    prisma.sequence.findMany({
      where: { deletedAt: null, project: projectAccess, OR: [{ name: contains }, { code: contains }] },
      select: { id: true, code: true, name: true, projectId: true },
      orderBy: { id: 'desc' },
      take: MAX_PER_TYPE,
    }),
    prisma.shot.findMany({
      where: { deletedAt: null, project: projectAccess, OR: [{ name: contains }, { code: contains }] },
      select: { id: true, code: true, name: true, projectId: true },
      orderBy: { id: 'desc' },
      take: MAX_PER_TYPE,
    }),
    prisma.asset.findMany({
      where: { deletedAt: null, project: projectAccess, name: contains },
      select: { id: true, name: true, type: true, projectId: true },
      orderBy: { id: 'desc' },
      take: MAX_PER_TYPE,
    }),
    prisma.task.findMany({
      where: {
        name: contains,
        OR: [
          { shot: { deletedAt: null, project: projectAccess } },
          { asset: { deletedAt: null, project: projectAccess } },
        ],
      },
      select: { id: true, name: true, type: true, shotId: true, assetId: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PER_TYPE,
    }),
  ]);

  return { projects, sequences, shots, assets, tasks };
}
