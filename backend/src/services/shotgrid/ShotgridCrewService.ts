// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { asString, type SgRecord } from './shotgridMapper';
import { openConnection } from './ShotgridConfigService';
import { upsertLink } from './shotgridLinks';
import * as UserService from '../UserService';
import * as ProjectService from '../ProjectService';
import { setMemberDepartments } from '../DepartmentService';
import { departmentFields, departmentLabel, matchDepartments } from './ShotgridCrewDepartments';
import type { SessionUser } from '../../lib/shotgridAccess';

/**
 * The project's ShotGrid team, and its entry into ReView.
 *
 * Linking a project brought its shots, tasks and media, but not the people. Every address had to be re-entered by hand in the
 * administration screen, then each person attached to the project: it is slow, and a single typo is enough for an artist never to
 * receive their notifications.
 *
 * The list comes from `Project.users` of the linked project: the team of THIS project, not the site directory. Nothing is created
 * on reading: it is an explicit gesture, account by account or in batch.
 */

/** What ReView already knows about this person. */
export type CrewState =
  /** Already a member of the project. */
  | 'member'
  /** An account exists (same address), but it is not on this project. */
  | 'account'
  /** No account: inviting will create one. */
  | 'none'
  /** No address, or deactivated on the site: nothing to do. */
  | 'ineligible';

export interface CrewPerson {
  sgId: number;
  name: string;
  login: string | null;
  email: string | null;
  /** `act`, `dis`... as the site declares it. */
  sgStatus: string | null;
  state: CrewState;
  userId: number | null;
  /**
   * True when the matching comes from a link **set by hand**, not from the address.
   * The screen says so: a chosen match is not undone by accident.
   */
  linkedByHand: boolean;
  /** Role on this project, when the person is already on it. */
  projectRole: Role | null;
  userRole: Role | null;
  /**
   * Department as the site names it: displayed even without a local match: it tells who we are dealing with, which the address
   * does not always say.
   */
  sgDepartment: string | null;
  /** Matching ReView department, when the studio already has one under this name. */
  department: { id: number; name: string } | null;
}

/**
 * Can a person receive access?
 *
 * Without an address, there is nothing to send the invitation to. Deactivated on the site, the person has left the studio: giving
 * them access would be exactly the opposite of what the site expresses.
 */
export function eligibility(record: { email: string | null; sgStatus: string | null }): boolean {
  if (!record.email) return false;
  return record.sgStatus === null || record.sgStatus === 'act';
}

/** A person's state, once cross-checked with the local database. */
export function crewState(
  person: { email: string | null; sgStatus: string | null },
  local: { userId: number | null; isMember: boolean },
): CrewState {
  if (!eligibility(person)) return 'ineligible';
  if (local.isMember) return 'member';
  return local.userId ? 'account' : 'none';
}

/**
 * Two `HumanUser` records may carry the same address on an old site. We keep the first active one: inviting the same person twice
 * would create a duplicate that the unique index on the address would refuse anyway, but with an incomprehensible error.
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

/** The remote project's team, cross-checked with the accounts and local members. */
export async function listCrew(projectId: number): Promise<CrewPerson[]> {
  const ctx = await openConnection(projectId);
  const project = await ctx.client.findById('Project', ctx.connection.sgProjectId, ['users']);
  const refs = Array.isArray(project?.users) ? (project.users as SgRecord[]) : [];
  const ids = refs.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return [];

  // The department is only requested once the schema has been consulted: a field the site does not declare does not return
  // "empty"; it makes the whole request fail.
  const deptFields = await departmentFields(ctx.client);
  const people = await ctx.client.search('HumanUser', {
    fields: ['name', 'email', 'login', 'sg_status_list', ...deptFields],
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
      sgDepartment: departmentLabel(p, deptFields),
    })),
  );
  const departments = await matchDepartments(
    projectId,
    raw.map((p) => p.sgDepartment),
  );

  const emails = raw.map((p) => p.email?.toLowerCase()).filter((e): e is string => Boolean(e));
  const locals = emails.length
    ? await prisma.user.findMany({
        // Case-insensitive: an account registered as "Alice@studio.com" would otherwise look nonexistent, and inviting
        // her would run into the unique index.
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true, role: true },
      })
    : [];
  const byEmail = new Map(locals.map((u) => [u.email.toLowerCase(), u]));

  // Explicit links: they take precedence over the address match, which is only a deduction. Without them, a person linked by
  // hand reappeared as "no account" on every read, for lack of a common address.
  const links = await prisma.shotgridLink.findMany({
    where: { connection: { projectId }, localType: 'user', sgType: 'HumanUser' },
    select: { localId: true, sgId: true },
  });
  const linkedBySgId = new Map(links.map((l) => [l.sgId, l.localId]));

  const candidateIds = [...new Set([...locals.map((u) => u.id), ...links.map((l) => l.localId)])];
  const linkedUsers = candidateIds.length
    ? await prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, email: true, role: true },
      })
    : [];
  const byId = new Map(linkedUsers.map((u) => [u.id, u]));

  const memberships = await prisma.projectMembership.findMany({
    where: { projectId, userId: { in: candidateIds } },
    select: { userId: true, role: true },
  });
  const byUser = new Map(memberships.map((m) => [m.userId, m.role]));

  return raw.map((person): CrewPerson => {
    const handLinked = linkedBySgId.get(person.sgId);
    const local = handLinked
      ? byId.get(handLinked)
      : person.email
        ? byEmail.get(person.email.toLowerCase())
        : undefined;
    const isMember = local ? byUser.has(local.id) : false;
    const matched = person.sgDepartment ? departments.get(person.sgDepartment) : undefined;
    return {
      sgId: person.sgId,
      name: person.name,
      login: person.login,
      email: person.email,
      sgStatus: person.sgStatus,
      state: crewState(person, { userId: local?.id ?? null, isMember }),
      userId: local?.id ?? null,
      linkedByHand: handLinked !== undefined,
      projectRole: local && isMember ? (byUser.get(local.id) ?? null) : null,
      userRole: local?.role ?? null,
      sgDepartment: person.sgDepartment,
      department: matched ? { id: matched.id, name: matched.name } : null,
    };
  });
}

/**
 * Links **by hand** a ShotGrid account to a ReView account.
 *
 * The automatic match is done by address, and that is the common case. But a studio always has a few people whose address differs
 * from one tool to the other: `first.last@studio.com` on one side, a personal address on the other. Without this gesture, these
 * accounts stayed unlinked forever: their writes went back to the site as an anonymous "ReView", and the imported team proposed them
 * indefinitely.
 *
 * `userId` set to null undoes the link: to correct an association set by mistake, which would otherwise assign someone's work to someone else.
 */
export async function linkCrewMember(projectId: number, sgId: number, userId: number | null): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    select: { id: true },
  });
  if (!connection) throw badRequest('This project is not connected to ShotGrid', 'NOT_CONNECTED');

  if (userId === null) {
    await prisma.shotgridLink.deleteMany({
      where: { connectionId: connection.id, sgType: 'HumanUser', sgId },
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw notFound('User not found');

  // A ReView account can only point to one site account, and vice versa: the two uniqueness constraints of `ShotgridLink` guarantee
  // it, but a pre-existing link would make the write fail instead of replacing it. We therefore clean up both sides first.
  await prisma.shotgridLink.deleteMany({
    where: {
      connectionId: connection.id,
      OR: [
        { sgType: 'HumanUser', sgId },
        { localType: 'user', localId: userId },
      ],
    },
  });

  const crew = await listCrew(projectId);
  const person = crew.find((p) => p.sgId === sgId);
  await upsertLink({
    connectionId: connection.id,
    localType: 'user',
    localId: userId,
    sgType: 'HumanUser',
    sgId,
    data: { login: person?.login ?? null, email: person?.email ?? user.email },
  });
}

export type InviteOutcome = 'created' | 'added' | 'linked' | 'skipped';

export interface InviteResult {
  sgId: number;
  outcome: InviteOutcome;
  reason?: string;
}

/**
 * What the invitation will do, before doing anything.
 *
 * Pure: the screen uses it to announce "3 accounts will be created" before asking for confirmation, and the service uses it to refuse
 * the whole batch at once if the actor is not allowed to create accounts, rather than creating three and failing on the fourth.
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
 * Grants ReView access, in one go.
 *
 * A missing account is created through the usual invitation circuit, the one that sends the e-mail and withdraws if the relay does not
 * answer. Nothing is reimplemented here: an account created without its activation e-mail is reachable by nobody and reserves the address.
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

  /**
   * The department the site declares, set on the member: **added**, never substituted: the person may already carry others, and the site
   * knows only one.
   *
   * A failure does not bring down the import: we have just granted access, and losing it over a label would be absurd. It is logged, and the
   * screen allows correcting it by hand.
   */
  const attachDepartment = async (person: CrewPerson, userId: number) => {
    if (!person.department) return;
    try {
      await setMemberDepartments(actor, projectId, userId, { add: [person.department.id] });
    } catch (err) {
      logger.warn({ err, sgId: person.sgId }, 'Département ShotGrid non appliqué');
    }
  };

  const link = async (person: CrewPerson, userId: number) => {
    if (!connection) return;
    // The link serves attribution: without it, a write made in this person's name goes back to the site as an anonymous "ReView".
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
        // ARTIST by default: it is the role that gives access to the work without opening anything else. A supervisor is promoted
        // afterwards, explicitly.
        role: Role.ARTIST,
      });
      await ProjectService.addMember(projectId, user.id);
      await link(person, user.id);
      await attachDepartment(person, user.id);
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
    // Existing account: we add it to the project without touching its global role.
    await ProjectService.addMember(projectId, person.userId!);
    await link(person, person.userId!);
    await attachDepartment(person, person.userId!);
    results.push({ sgId: person.sgId, outcome: 'added' });
  }

  for (const person of plan.skip) {
    // Already a member: we still set the link, which is often missing: it is what allows writing to the site in this person's name.
    if (person.state === 'member' && person.userId) {
      await link(person, person.userId);
      await attachDepartment(person, person.userId);
      results.push({ sgId: person.sgId, outcome: 'linked' });
    } else {
      results.push({ sgId: person.sgId, outcome: 'skipped', reason: person.state });
    }
  }

  return results;
}
