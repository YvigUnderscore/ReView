// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, forbidden } from '../../lib/errors';
import { asString, type SgRecord } from './shotgridMapper';
import { openConnection } from './ShotgridConfigService';
import { upsertLink } from './shotgridLinks';
import * as UserService from '../UserService';
import * as ProjectService from '../ProjectService';
import type { SessionUser } from '../../lib/shotgridAccess';

/**
 * L'équipe du projet ShotGrid, et son entrée dans ReView.
 *
 * Relier un projet apportait ses plans, ses tâches et ses médias — mais pas les gens.
 * Il fallait ressaisir chaque adresse à la main dans l'écran d'administration, puis
 * rattacher chacun au projet : c'est long, et une faute de frappe suffit pour qu'un
 * artiste ne reçoive jamais ses notifications.
 *
 * La liste vient de `Project.users` du projet lié — l'équipe de CE projet, pas l'annuaire
 * du site. Rien n'est créé à la lecture : c'est un geste explicite, compte par compte ou
 * par lot.
 */

/** Ce que ReView sait déjà de cette personne. */
export type CrewState =
  /** Déjà membre du projet. */
  | 'member'
  /** Un compte existe (même adresse), mais il n'est pas sur ce projet. */
  | 'account'
  /** Aucun compte : l'inviter en créera un. */
  | 'none'
  /** Sans adresse, ou désactivé côté site : rien à faire. */
  | 'ineligible';

export interface CrewPerson {
  sgId: number;
  name: string;
  login: string | null;
  email: string | null;
  /** `act`, `dis`… tel que le site le déclare. */
  sgStatus: string | null;
  state: CrewState;
  userId: number | null;
  /** Rôle sur ce projet, quand la personne y est déjà. */
  projectRole: Role | null;
  userRole: Role | null;
}

/**
 * Une personne peut-elle recevoir un accès ?
 *
 * Sans adresse, il n'y a rien à quoi envoyer l'invitation. Désactivée sur le site, elle a
 * quitté le studio — lui ouvrir un accès serait exactement le contraire de ce que le site
 * exprime.
 */
export function eligibility(record: { email: string | null; sgStatus: string | null }): boolean {
  if (!record.email) return false;
  return record.sgStatus === null || record.sgStatus === 'act';
}

/** L'état d'une personne, une fois croisée avec la base locale. */
export function crewState(
  person: { email: string | null; sgStatus: string | null },
  local: { userId: number | null; isMember: boolean },
): CrewState {
  if (!eligibility(person)) return 'ineligible';
  if (local.isMember) return 'member';
  return local.userId ? 'account' : 'none';
}

/**
 * Deux `HumanUser` peuvent porter la même adresse sur un site ancien. On garde le premier
 * actif — inviter deux fois la même personne créerait un doublon que l'index unique de
 * l'adresse refuserait de toute façon, mais avec une erreur incompréhensible.
 */
export function dedupeCrew<T extends { email: string | null; sgStatus: string | null }>(people: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const person of [...people].sort(
    (a, b) => Number(b.sgStatus === 'act') - Number(a.sgStatus === 'act'),
  )) {
    const key = (person.email ?? '').toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(person);
  }
  return out;
}

/** L'équipe du projet distant, croisée avec les comptes et les membres locaux. */
export async function listCrew(projectId: number): Promise<CrewPerson[]> {
  const ctx = await openConnection(projectId);
  const project = await ctx.client.findById('Project', ctx.connection.sgProjectId, ['users']);
  const refs = Array.isArray(project?.users) ? (project.users as SgRecord[]) : [];
  const ids = refs.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return [];

  const people = await ctx.client.search('HumanUser', {
    fields: ['name', 'email', 'login', 'sg_status_list'],
    filters: [['id', 'in', ids]],
    sort: 'name',
  });

  const raw = dedupeCrew(
    people.map((p: SgRecord) => ({
      sgId: p.id,
      name: asString(p.name) ?? asString(p.login) ?? `#${p.id}`,
      login: asString(p.login),
      email: asString(p.email),
      sgStatus: asString(p.sg_status_list),
    })),
  );

  const emails = raw.map((p) => p.email?.toLowerCase()).filter((e): e is string => Boolean(e));
  const locals = emails.length
    ? await prisma.user.findMany({
        // Insensible à la casse : un compte enregistré « Alice@studio.com » passerait
        // autrement pour inexistant, et l'inviter buterait sur l'index unique.
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true, role: true },
      })
    : [];
  const byEmail = new Map(locals.map((u) => [u.email.toLowerCase(), u]));

  const memberships = await prisma.projectMembership.findMany({
    where: { projectId, userId: { in: locals.map((u) => u.id) } },
    select: { userId: true, role: true },
  });
  const byUser = new Map(memberships.map((m) => [m.userId, m.role]));

  return raw.map((person): CrewPerson => {
    const local = person.email ? byEmail.get(person.email.toLowerCase()) : undefined;
    const isMember = local ? byUser.has(local.id) : false;
    return {
      sgId: person.sgId,
      name: person.name,
      login: person.login,
      email: person.email,
      sgStatus: person.sgStatus,
      state: crewState(person, { userId: local?.id ?? null, isMember }),
      userId: local?.id ?? null,
      projectRole: local && isMember ? (byUser.get(local.id) ?? null) : null,
      userRole: local?.role ?? null,
    };
  });
}

export type InviteOutcome = 'created' | 'added' | 'linked' | 'skipped';

export interface InviteResult {
  sgId: number;
  outcome: InviteOutcome;
  reason?: string;
}

/**
 * Ce que fera l'invitation, avant de faire quoi que ce soit.
 *
 * Pure : l'écran s'en sert pour annoncer « 3 comptes seront créés » avant de demander
 * confirmation, et le service pour refuser tout le lot d'un coup si l'acteur n'a pas le
 * droit de créer des comptes — plutôt que d'en créer trois puis d'échouer au quatrième.
 */
export function planInvites(
  crew: CrewPerson[],
  sgIds: number[],
  options: { canCreateAccounts: boolean },
): { create: CrewPerson[]; add: CrewPerson[]; skip: CrewPerson[] } {
  const wanted = new Set(sgIds);
  const selected = crew.filter((p) => wanted.has(p.sgId));
  const create = selected.filter((p) => p.state === 'none');
  const add = selected.filter((p) => p.state === 'account');
  const skip = selected.filter((p) => p.state === 'member' || p.state === 'ineligible');
  if (create.length > 0 && !options.canCreateAccounts) {
    throw forbidden(
      'Creating studio accounts is reserved to administrators and studio supervisors',
      'CREATE_ACCOUNT_FORBIDDEN',
    );
  }
  return { create, add, skip };
}

/**
 * Donne l'accès à ReView, en une fois.
 *
 * Un compte manquant est créé par le circuit d'invitation habituel — celui qui envoie le
 * courriel et se rétracte si le relais ne répond pas. On ne réimplémente rien : un compte
 * créé sans son courriel d'activation n'est joignable par personne et réserve l'adresse.
 */
export async function inviteCrew(
  actor: SessionUser,
  projectId: number,
  sgIds: number[],
  options: { canCreateAccounts: boolean },
): Promise<InviteResult[]> {
  if (sgIds.length === 0) throw badRequest('Select at least one person', 'EMPTY_SELECTION');
  const crew = await listCrew(projectId);
  const plan = planInvites(crew, sgIds, options);
  const connection = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    select: { id: true },
  });
  const results: InviteResult[] = [];

  const link = async (person: CrewPerson, userId: number) => {
    if (!connection) return;
    // Le lien sert à l'attribution : sans lui, une écriture faite au nom de cette
    // personne repart en « ReView » anonyme côté site.
    await upsertLink({
      connectionId: connection.id,
      localType: 'user',
      localId: userId,
      sgType: 'HumanUser',
      sgId: person.sgId,
      data: { login: person.login ?? null, email: person.email ?? null },
    });
  };

  for (const person of plan.create) {
    try {
      const user = await UserService.createUser(actor.id, {
        email: person.email!,
        name: person.name,
        // ARTIST par défaut : c'est le rôle qui donne accès au travail sans rien ouvrir
        // d'autre. Un superviseur se promeut ensuite, explicitement.
        role: Role.ARTIST,
      });
      await ProjectService.addMember(projectId, user.id);
      await link(person, user.id);
      results.push({ sgId: person.sgId, outcome: 'created' });
    } catch (err) {
      logger.warn({ err, sgId: person.sgId }, 'Invitation ShotGrid en échec');
      results.push({
        sgId: person.sgId,
        outcome: 'skipped',
        reason: err instanceof Error ? err.message : undefined,
      });
    }
  }

  for (const person of plan.add) {
    // Compte existant : on l'ajoute au projet sans toucher à son rôle global.
    await ProjectService.addMember(projectId, person.userId!);
    await link(person, person.userId!);
    results.push({ sgId: person.sgId, outcome: 'added' });
  }

  for (const person of plan.skip) {
    // Déjà membre : on pose tout de même le lien, qui manque souvent — c'est lui qui
    // permet d'écrire sur le site au nom de cette personne.
    if (person.state === 'member' && person.userId) {
      await link(person, person.userId);
      results.push({ sgId: person.sgId, outcome: 'linked' });
    } else {
      results.push({ sgId: person.sgId, outcome: 'skipped', reason: person.state });
    }
  }

  return results;
}
