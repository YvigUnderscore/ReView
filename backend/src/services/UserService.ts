// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { invalidateAuthUser } from '../lib/userCache';
import { logAudit } from './AuditService';
import * as InvitationService from './InvitationService';
import { storage, StorageService } from '../lib/storage';
import { getOnlineUserIds } from './PresenceService';
import { toPublicUser } from '../lib/userView';
import { normalizeEmail } from '../lib/email';
import { revokeAllCredentials } from '../lib/sessions';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors';
import { NOTIFICATION_SETTINGS_KEY, notificationSettingsSchema } from '../lib/notificationKinds';
import { OVERVIEW_PREFERENCE_KEY, overviewLayoutSchema } from '../lib/overviewWidgets';

/**
 * Business logic for users (profile, presence, account administration).
 * Routes only validate (RBAC + Zod) -> call -> respond (10.D8).
 */

const publicUser = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  jobTitle: true,
  bio: true,
  phone: true,
  role: true,
  status: true,
  lastSeenAt: true,
  avatarKey: true,
  storageUsed: true,
  storageLimit: true,
  disabledAt: true,
  createdAt: true,
} as const;

/**
 * Refuses to remove the studio's last administrator.
 *
 * Nothing prevented the sole ADMIN from demoting themselves, deactivating themselves or being deleted: the instance
 * stayed up but nobody could create an account, assign a role or touch the settings, and the back door is closed
 * (`setup` refuses to run again once a studio exists). The only recourse was a SQL UPDATE on the database.
 *
 * Only administrators who are really usable count: a service account carries the writes of a machine token and never
 * logs in, and a deactivated account does not either.
 */
export async function assertNotLastAdmin(id: number): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true, isService: true, disabledAt: true },
  });
  if (!target || target.role !== Role.ADMIN || target.isService || target.disabledAt) return;
  const others = await prisma.user.count({
    where: { id: { not: id }, role: Role.ADMIN, isService: false, disabledAt: null },
  });
  if (others === 0) throw badRequest('The last administrator of the studio cannot be removed', 'LAST_ADMIN');
}

/** Refuses a username/email already taken by another user (excludeId = the account being edited). */
async function assertUniqueIdentity(
  username: string | undefined,
  email: string | undefined,
  excludeId: number,
) {
  if (username) {
    const taken = await prisma.user.findFirst({
      where: { username, id: { not: excludeId } },
      select: { id: true },
    });
    if (taken) throw badRequest('Username already taken', 'USERNAME_TAKEN');
  }
  if (email) {
    const taken = await prisma.user.findFirst({
      where: { email, id: { not: excludeId } },
      select: { id: true },
    });
    if (taken) throw badRequest('Email already in use', 'EMAIL_TAKEN');
  }
}

/**
 * Full list (administrators/supervisors) with online state.
 * Service accounts (machine tokens) are excluded: they are carriers of writes, not members of the studio:
 * they have neither presence nor a reachable address.
 */
export async function listUsers() {
  const [users, pending] = await Promise.all([
    prisma.user.findMany({
      where: { isService: false },
      select: publicUser,
      orderBy: { createdAt: 'asc' },
    }),
    // A single query for the whole list: an account still awaiting activation is flagged in the directory,
    // otherwise there is no way to tell "invited" from "never came".
    prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { userId: true },
    }),
  ]);
  const online = new Set(getOnlineUserIds());
  const invited = new Set(pending.map((i) => i.userId));
  return Promise.all(
    users.map(async (u) => ({
      ...(await toPublicUser(u)),
      online: online.has(u.id),
      invitePending: invited.has(u.id),
    })),
  );
}

/**
 * Presence of the people the requester is allowed to see.
 *
 * The e-mail is removed from the response: `toPublicUser` copies the object it is given (`...u`); it was used here to
 * compute the display name and went out with it. This was the studio's full directory, addresses included, offered to
 * any guest.
 *
 * Segregation has gone further since C1: a CLIENT is an external contributor, does not need to know the whole team nor
 * be able to write to anyone. They see only the people of the projects they share. Other roles see the studio, as before:
 * they work in it.
 */
export async function listPresence(viewer?: { id: number; role: Role }) {
  const scope =
    viewer?.role === Role.CLIENT
      ? {
          memberships: {
            some: { project: { memberships: { some: { userId: viewer.id } } } },
          },
        }
      : {};
  // A deactivated account leaves the directory (A5-07), as it already leaves the global search (`lib/search.ts`).
  // Two reasons, and the second is the more operational: a former employee's name stayed published to the whole studio,
  // external CLIENT accounts included; and this directory feeds mentions and the choice of a recipient. Assigning work to
  // someone who can no longer log in serves nobody.
  const users = await prisma.user.findMany({
    where: { isService: false, disabledAt: null, ...scope },
    select: {
      id: true,
      email: true, // needed for the displayName/initials fallback; removed from the output below
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      avatarKey: true,
      status: true,
      lastSeenAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const online = new Set(getOnlineUserIds());
  return Promise.all(
    users.map(async (u) => {
      const { email: _email, ...view } = await toPublicUser(u);
      return { ...view, online: online.has(u.id) };
    }),
  );
}

/**
 * Public profile of a studio member, readable by any authenticated account.
 *
 * Contact details (e-mail, phone) are served only to internal accounts: an external CLIENT sees the directory to know who
 * they are speaking to in review, not the studio's address book. The projects listed are those both people share, so the
 * intersection reveals nothing the reader does not already see.
 */
export async function getProfile(viewerId: number, viewerRole: Role, id: number) {
  const user = await prisma.user.findFirst({ where: { id, isService: false }, select: publicUser });
  if (!user) throw notFound('User not found');

  const shared =
    viewerId === id
      ? []
      : await prisma.project.findMany({
          where: {
            // Two `memberships.some` cannot coexist in the same object (the second would overwrite the first):
            // the intersection goes through an explicit AND.
            AND: [
              { memberships: { some: { userId: id } } },
              ...(viewerRole === Role.ADMIN || viewerRole === Role.SUPERVISOR
                ? []
                : [{ memberships: { some: { userId: viewerId } } }]),
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 20,
        });

  const isInternal = viewerRole !== Role.CLIENT;
  const view = await toPublicUser(user);
  return {
    ...view,
    email: isInternal ? view.email : undefined,
    phone: isInternal ? view.phone : undefined,
    // The storage quota is administrative data, not a sheet element.
    storageUsed: undefined,
    storageLimit: undefined,
    online: getOnlineUserIds().includes(id),
    sharedProjects: shared,
    isSelf: viewerId === id,
  };
}

export interface UpdateMeInput {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  phone?: string | null;
  email?: string;
  password?: string;
}

/**
 * Guard for changes to the login credentials (password, e-mail).
 *
 * An API token (36.C) is an automation secret, often stored in clear text in a CI: letting it change the password and the
 * e-mail would make it a full account-takeover path, 2FA included, since no factor is asked again. A real session, for its
 * part, must re-enter the current password: a stolen token is not enough to lock someone else out of their account.
 */
export async function assertCredentialChange(
  userId: number,
  body: UpdateMeInput & { currentPassword?: string },
  viaApiToken: boolean,
): Promise<void> {
  if (body.password === undefined && body.email === undefined) return;
  if (viaApiToken)
    throw forbidden('An API token cannot change the password or the email', 'API_TOKEN_FORBIDDEN');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!user) throw unauthorized();
  if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, user.password)))
    throw unauthorized('The current password is required', 'CURRENT_PASSWORD_REQUIRED');
}

export async function updateMe(userId: number, body: UpdateMeInput, keepSessionId?: string) {
  const email = body.email !== undefined ? normalizeEmail(body.email) : undefined;
  await assertUniqueIdentity(body.username || undefined, email, userId);
  const data: Record<string, unknown> = {};
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.username !== undefined) data.username = body.username;
  if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle;
  if (body.bio !== undefined) data.bio = body.bio;
  if (body.phone !== undefined) data.phone = body.phone;
  if (email !== undefined) data.email = email;
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.update({ where: { id: userId }, data, select: publicUser });
  // Changing one's password (or e-mail, which is the login identifier) must cut the sessions open elsewhere: otherwise
  // a stolen token survives the account being taken back. The current session is kept so as not to log out the author.
  if (body.password !== undefined || email !== undefined) {
    await revokeAllCredentials(userId, keepSessionId);
  }
  return toPublicUser(user);
}

export async function setStatus(userId: number, status: UserStatus) {
  const user = await prisma.user.update({ where: { id: userId }, data: { status }, select: publicUser });
  return toPublicUser(user);
}

export async function presignAvatar(userId: number, contentType: string) {
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const key = StorageService.avatarKey(userId, ext);
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

/**
 * Exact shape of an avatar key: `avatars/<id>.<ext>`, as `StorageService` builds it. The comparison is made on the CAPTURED
 * identifier, never on a prefix: `'avatars/91.png'.startsWith('avatars/9')` is true, and that is how account 9 served the
 * avatar of account 91 (A1-04/A2-06). The two checks of the same kind (`DepartmentService.setImage`,
 * `EntityThumbnailService.set`) are, for their part, delimited.
 */
const AVATAR_KEY_RE = /^avatars\/(\d+)\.(?:png|jpe?g|webp)$/;

export async function setAvatar(userId: number, key: string | null) {
  // Security: the key must designate EXACTLY the current user's avatar. The check lives here, in the service: the route
  // is today its only caller, but it is the service that writes to the database; a guard placed only at the HTTP entry
  // falls at the first second caller (worker, import, migration script).
  if (key !== null && AVATAR_KEY_RE.exec(key)?.[1] !== String(userId))
    throw badRequest('Invalid avatar key', 'BAD_KEY');
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarKey: key },
    select: publicUser,
  });
  return toPublicUser(user);
}

export interface CreateUserInput {
  email: string;
  /** Absent in invitation mode: the person will choose their own from the link received. */
  password?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: Role;
}

/**
 * Creates an account. Without a password, the account can only be activated through the invitation link sent by e-mail:
 * its password is a random value that nobody, not even the administrator who has just created the account, has ever seen.
 */
export async function createUser(actorId: number, input: CreateUserInput) {
  const email = normalizeEmail(input.email);
  if (await prisma.user.findUnique({ where: { email } }))
    throw badRequest('Email already in use', 'EMAIL_TAKEN');
  if (input.username && (await prisma.user.findUnique({ where: { username: input.username } })))
    throw badRequest('Username already taken', 'USERNAME_TAKEN');
  const byInvitation = input.password === undefined;
  // Relay and public URL are checked BEFORE creation: an account created and then deprived of its activation e-mail
  // would be reachable by no one, and its address would remain taken.
  if (byInvitation) await InvitationService.assertCanInvite();

  const hash = await bcrypt.hash(input.password ?? randomBytes(32).toString('hex'), 12);
  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      name: input.name ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      username: input.username ?? null,
      role: input.role,
    },
    select: publicUser,
  });
  if (byInvitation) {
    try {
      await InvitationService.sendInvitation(user.id, actorId);
    } catch (err) {
      // The relay dropped between the check and the send: we do not leave behind a silent account that reserves the
      // address. The administrator retries once it is repaired.
      await prisma.user.delete({ where: { id: user.id } });
      throw err;
    }
  }
  logAudit({
    userId: actorId,
    action: 'USER_CREATE',
    entityType: 'User',
    entityId: user.id,
    metadata: { invited: byInvitation },
  });
  return toPublicUser(user);
}

export async function changeRole(actorId: number, id: number, role: Role) {
  if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('User not found');
  if (role !== Role.ADMIN) await assertNotLastAdmin(id);
  const user = await prisma.user.update({ where: { id }, data: { role }, select: publicUser });
  // The role is cached per request (lib/userCache): without this invalidation, a demoted account would keep its
  // rights for half a minute.
  invalidateAuthUser(id);
  logAudit({
    userId: actorId,
    action: 'USER_ROLE_CHANGE',
    entityType: 'User',
    entityId: id,
    metadata: { role },
  });
  return toPublicUser(user);
}

export interface AdminUpdateUserInput extends UpdateMeInput {
  name?: string | null;
  role?: Role;
  storageLimit?: number | null;
  /** Deactivation (`true`) or reactivation (`false`) of the account: see `setDisabled`. */
  disabled?: boolean;
}

export async function updateUser(actorId: number, id: number, body: AdminUpdateUserInput) {
  const target = await prisma.user.findUnique({ where: { id }, select: { disabledAt: true } });
  if (!target) throw notFound('User not found');
  // Demoting or deactivating the sole administrator would make the studio unmanageable.
  if ((body.role !== undefined && body.role !== Role.ADMIN) || body.disabled === true)
    await assertNotLastAdmin(id);
  const email = body.email !== undefined ? normalizeEmail(body.email) : undefined;
  await assertUniqueIdentity(body.username || undefined, email, id);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.username !== undefined) data.username = body.username;
  if (email !== undefined) data.email = email;
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  if (body.role !== undefined) data.role = body.role;
  if (body.storageLimit !== undefined)
    data.storageLimit = body.storageLimit === null ? null : BigInt(body.storageLimit);
  // Deactivating an already deactivated account again does not renew the date: it is the departure date.
  if (body.disabled !== undefined) data.disabledAt = body.disabled ? (target.disabledAt ?? new Date()) : null;
  const user = await prisma.user.update({ where: { id }, data, select: publicUser });
  invalidateAuthUser(id);
  // The audit names the notable event: a deactivation is not an edit of a record.
  const action = body.disabled === undefined ? 'USER_UPDATE' : body.disabled ? 'USER_DISABLE' : 'USER_ENABLE';
  logAudit({ userId: actorId, action, entityType: 'User', entityId: id });
  // An admin who resets a password, changes the login e-mail, demotes a role or deactivates an account is usually acting
  // on a compromised account or a departure: the tokens already issued (which carry the old role) must not survive the operation.
  if (
    body.password !== undefined ||
    email !== undefined ||
    body.role !== undefined ||
    body.disabled === true
  ) {
    await revokeAllCredentials(id);
  }
  return toPublicUser(user);
}

/**
 * Deactivates (or reactivates) an account: the default path for a departure.
 *
 * Hard deletion converges on `User` through twelve cascades and twenty `SetNull`: it takes the notifications, the
 * subscriptions, the sessions... and above all empties `AuditLog.userId`, that is, the author of the logged actions.
 * A studio's audit register outlives its employees; the account only has to stop working. Deactivation cuts access
 * (session and tokens revoked on the spot) without erasing anything.
 */
export async function setDisabled(actorId: number, id: number, disabled: boolean) {
  if (disabled && id === actorId) throw badRequest('You cannot disable your own account');
  return updateUser(actorId, id, { disabled });
}

/**
 * Permanent deletion of an account: an explicit action, never the default path.
 * Prefer `setDisabled`: deletion takes the author of the logged actions with it.
 */
export async function deleteUser(actorId: number, id: number) {
  if (id === actorId) throw badRequest('You cannot delete your own account');
  await assertNotLastAdmin(id);
  // Share links are `SetNull`: deleting the account used to leave them ALIVE, and now without an owner. A departure
  // therefore did not cut the public access the person had opened, although that is exactly what an offboarding should do.
  const revoked = await prisma.shareLink.updateMany({
    where: { createdById: id, revoked: false },
    data: { revoked: true },
  });
  await prisma.user.delete({ where: { id } });
  invalidateAuthUser(id);
  logAudit({
    userId: actorId,
    action: 'USER_DELETE',
    entityType: 'User',
    entityId: id,
    metadata: { revokedShareLinks: revoked.count },
  });
}

// ── UI preferences (free JSON per user: kanban views, etc.) ──────────

const PREFERENCES_MAX_BYTES = 32_768;

/**
 * Number of keys kept at the first level of the bag (A2-04).
 *
 * The total size is not enough: the merge is shallow and never removes a key that is not asked for again, so an ordinary
 * account could grow the key list from one `PATCH` to the next until it saturated the byte cap, and leave it there
 * permanently, since only an explicit `null` per key allows taking one back. Bounding the NUMBER of keys makes the
 * accumulation refusable before it gets there, and makes the refusal actionable: the message says what to delete. The
 * front-end type (`UserPreferences`) counts about a dozen; two hundred leave all the margin a feature will need.
 */
const PREFERENCES_MAX_KEYS = 200;

/**
 * Admissible leaf of a preference. Each string is bounded for the same reason as in `lib/commentPayload`: without it, a
 * single field is enough to fill the whole budget.
 */
const preferenceLeaf = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);

/**
 * Admissible value, built by DESCENDING over a finite depth rather than with a recursive `z.lazy()`: the depth becomes a
 * property of the schema, not a race between the Node stack and the size of the body. Five levels cover the most nested
 * of the real preferences (`savedViews`: scope -> list of views -> `filters`).
 */
function preferenceValue(depth: number): z.ZodTypeAny {
  if (depth === 0) return preferenceLeaf;
  const inner = preferenceValue(depth - 1);
  return z.union([
    preferenceLeaf,
    z.array(inner).max(500),
    z.record(z.string().max(64), inner).refine((o) => Object.keys(o).length <= PREFERENCES_MAX_KEYS),
  ]);
}

/**
 * Admissible body of `PATCH /api/users/me/preferences`. The key was already bounded to 64 characters, the VALUE was not:
 * `z.unknown()` let through any shape, of any depth, up to the body parser's ceiling (2 MB). The schema lives here, and not
 * in the route, because what a preference is allowed to contain falls under the same decision as the merge that writes it.
 */
export const preferencesPatchSchema = z
  .record(z.string().max(64), preferenceValue(5))
  // A bag key now has a FIXED shape: the notification settings per event type. Without this check, a misspelt kind was
  // written without a murmur and cut nothing: the setting seemed taken and the event kept arriving.
  .refine(
    (patch) =>
      !(NOTIFICATION_SETTINGS_KEY in patch) ||
      notificationSettingsSchema.nullable().safeParse(patch[NOTIFICATION_SETTINGS_KEY]).success,
    { message: 'Invalid notification settings', path: [NOTIFICATION_SETTINGS_KEY] },
  )
  // Same reason for the overview layout: an invented block identifier was stored without a murmur and displayed nothing.
  // The list of blocks lives in `lib/overviewWidgets`, copied on the front end, and it is that list which is authoritative on write.
  .refine(
    (patch) =>
      !(OVERVIEW_PREFERENCE_KEY in patch) ||
      overviewLayoutSchema.nullable().safeParse(patch[OVERVIEW_PREFERENCE_KEY]).success,
    { message: 'Invalid overview layout', path: [OVERVIEW_PREFERENCE_KEY] },
  );

export async function getPreferences(userId: number): Promise<Record<string, unknown>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  if (!u) throw notFound('User not found');
  return (u.preferences ?? {}) as Record<string, unknown>;
}

/** Shallow merge: key at `null` = deletion; size AND number of keys bounded. */
export async function updatePreferences(
  userId: number,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getPreferences(userId);
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  // Both caps apply to the RESULT of the merge, not to the call: accumulation is the default (A2-04), and a single call
  // is always tiny.
  //
  // The key cap only blocks what GROWS: a bag already too full (data written before the cap) must remain reducible,
  // otherwise the refusal would lock its owner into the very state being reproached, `null` deletions included.
  const keyCount = Object.keys(next).length;
  if (keyCount > PREFERENCES_MAX_KEYS && keyCount >= Object.keys(current).length)
    throw badRequest('Too many preference keys', 'PREFERENCES_TOO_MANY_KEYS');
  if (JSON.stringify(next).length > PREFERENCES_MAX_BYTES)
    throw badRequest('Preferences are too large', 'PREFERENCES_TOO_LARGE');
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as Prisma.InputJsonObject },
  });
  return next;
}
