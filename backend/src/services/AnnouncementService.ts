import { Role, AnnouncementType, AnnouncementFrequency, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { logAudit } from './AuditService';

/**
 * Annonces studio (Phase 22) : CRUD admin + résolution des annonces « actives » pour un
 * utilisateur selon la période, le ciblage par rôle et la fréquence (permanent / 1re connexion /
 * 1re du jour), pilotée par les accusés de lecture (`AnnouncementRead`).
 */

type SessionUser = { id: number; role: Role };

export interface AnnouncementInput {
  title: string;
  body: string;
  type: AnnouncementType;
  frequency: AnnouncementFrequency;
  roles: Role[];
  startsAt?: string | null;
  endsAt?: string | null;
  active: boolean;
}

const data = (i: AnnouncementInput) => ({
  title: i.title,
  body: i.body,
  type: i.type,
  frequency: i.frequency,
  roles: i.roles as unknown as Prisma.InputJsonValue,
  startsAt: i.startsAt ? new Date(i.startsAt) : null,
  endsAt: i.endsAt ? new Date(i.endsAt) : null,
  active: i.active,
});

/** Liste complète (admin) + nombre d'accusés de lecture. */
export async function list() {
  return prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { reads: true } } },
  });
}

export async function create(user: SessionUser, input: AnnouncementInput) {
  const a = await prisma.announcement.create({ data: data(input) });
  logAudit({ userId: user.id, action: 'ANNOUNCEMENT_CREATE', entityType: 'Announcement', entityId: a.id });
  return a;
}

export async function update(user: SessionUser, id: number, input: AnnouncementInput) {
  if (!(await prisma.announcement.findUnique({ where: { id } }))) throw notFound('Annonce introuvable');
  const a = await prisma.announcement.update({ where: { id }, data: data(input) });
  logAudit({ userId: user.id, action: 'ANNOUNCEMENT_UPDATE', entityType: 'Announcement', entityId: id });
  return a;
}

export async function remove(user: SessionUser, id: number) {
  if (!(await prisma.announcement.findUnique({ where: { id } }))) throw notFound('Annonce introuvable');
  await prisma.announcement.delete({ where: { id } });
  logAudit({ userId: user.id, action: 'ANNOUNCEMENT_DELETE', entityType: 'Announcement', entityId: id });
}

/** Une lecture le même jour civil UTC (fréquence 1re du jour — déterministe, sans fuseau). */
function readToday(readAt: Date, now: Date): boolean {
  return (
    readAt.getUTCFullYear() === now.getUTCFullYear() &&
    readAt.getUTCMonth() === now.getUTCMonth() &&
    readAt.getUTCDate() === now.getUTCDate()
  );
}

/** Décide si une annonce doit s'afficher pour cet utilisateur selon fréquence + dernier accusé. */
export function shouldShow(frequency: AnnouncementFrequency, lastReadAt: Date | null, now: Date): boolean {
  if (frequency === AnnouncementFrequency.PERMANENT) return true;
  if (!lastReadAt) return true;
  if (frequency === AnnouncementFrequency.FIRST_LOGIN) return false;
  // FIRST_OF_DAY : réafficher si le dernier accusé n'est pas d'aujourd'hui.
  return !readToday(lastReadAt, now);
}

/** Annonces à présenter maintenant à l'utilisateur (période + rôle + fréquence). */
export async function active(user: SessionUser) {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: { reads: { where: { userId: user.id }, select: { readAt: true } } },
  });
  return rows
    .filter((a) => {
      const roles = Array.isArray(a.roles) ? (a.roles as string[]) : [];
      if (roles.length > 0 && !roles.includes(user.role)) return false;
      return shouldShow(a.frequency, a.reads[0]?.readAt ?? null, now);
    })
    .map(({ reads: _reads, ...a }) => a);
}

/** Accusé de lecture (upsert) : masque l'annonce selon sa fréquence. */
export async function acknowledge(user: SessionUser, id: number) {
  if (!(await prisma.announcement.findUnique({ where: { id }, select: { id: true } })))
    throw notFound('Annonce introuvable');
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId: user.id } },
    update: { readAt: new Date() },
    create: { announcementId: id, userId: user.id },
  });
}
