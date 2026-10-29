// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A2-04: `PATCH /api/users/me/preferences` validated `z.record(z.string().max(64), z.unknown())`: the KEY was bounded,
 * the VALUE was not. Any ordinary account therefore wrote JSON of free shape and depth into its `preferences` column,
 * and since the merge was shallow, each call ADDED a key without ever removing one.
 *
 * Two halves answer each other here: the schema bounds what a value may be, the merge bounds what the bag may become.
 */

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./InvitationService', () => ({ sendInvitation: vi.fn() }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { avatarKey: vi.fn() },
}));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: vi.fn(() => []) }));
vi.mock('../lib/userCache', () => ({ invalidateAuthUser: vi.fn() }));
vi.mock('../lib/sessions', () => ({ revokeAllCredentials: vi.fn() }));
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn() }));

import { preferencesPatchSchema, updatePreferences } from './UserService';

const accepts = (value: unknown) => preferencesPatchSchema.safeParse({ k: value }).success;

/** Bag already stored for this account. */
const stored = (preferences: Record<string, unknown>) =>
  db.user.findUnique.mockResolvedValue({ preferences });

const manyKeys = (n: number, prefix = 'k') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, true]));

beforeEach(() => {
  vi.clearAllMocks();
  db.user.update.mockResolvedValue({});
});

describe('preferencesPatchSchema: what the interface actually saves passes', () => {
  it('accepts existing preferences, nested ones included', () => {
    const real = {
      emailDigest: true,
      annotationColor: '#ef4444',
      locale: 'fr',
      density: 'compact',
      shortcuts: { 'review.next': 'ArrowRight' },
      savedViews: { 'shots:12': [{ id: 'v1', name: 'Retakes', filters: { status: 'RETAKE' } }] },
      homeWidgets: { hidden: ['calendar'], order: ['tasks'], settings: { tasks: { limit: 5 } } },
      onboardingSeen: null,
    };
    expect(preferencesPatchSchema.safeParse(real).success).toBe(true);
  });

  it('refuses an oversized string: one field cannot eat the whole budget', () => {
    expect(accepts('x'.repeat(4_000))).toBe(true);
    expect(accepts('x'.repeat(4_001))).toBe(false);
  });

  it('refuses unbounded nesting', () => {
    const nest = (depth: number): unknown => (depth === 0 ? 1 : { a: nest(depth - 1) });
    expect(accepts(nest(5))).toBe(true);
    expect(accepts(nest(7))).toBe(false);
  });

  it('refuses an oversized array or sub-object', () => {
    expect(accepts(Array.from({ length: 501 }, () => 1))).toBe(false);
    expect(accepts(manyKeys(201, 'n'))).toBe(false);
  });

  it('refuses an overlong top-level key', () => {
    expect(preferencesPatchSchema.safeParse({ ['k'.repeat(65)]: true }).success).toBe(false);
  });
});

describe('updatePreferences: the bag does not grow indefinitely', () => {
  it('refuses adding one more key beyond the cap, without writing anything', async () => {
    stored(manyKeys(200));
    await expect(updatePreferences(7, { unDeTrop: true })).rejects.toMatchObject({
      code: 'PREFERENCES_TOO_MANY_KEYS',
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('lets an existing key be replaced when the cap is reached', async () => {
    stored(manyKeys(200));
    await expect(updatePreferences(7, { k0: false })).resolves.toMatchObject({ k0: false });
  });

  /** A bag predating the cap must remain reducible, otherwise the refusal would lock it in. */
  it('lets keys be taken over in a bag already too full', async () => {
    stored(manyKeys(260));
    await expect(updatePreferences(7, { k0: null })).resolves.toBeTruthy();
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * The overview layout (batch 10) has, like the notification settings, a FIXED shape in the bag: what is written there
 * must cite blocks the screen knows how to render.
 */
describe('preferencesPatchSchema: overview layout', () => {
  const layout = (value: unknown) => preferencesPatchSchema.safeParse({ projectOverview: value }).success;

  it('accepts what the page actually composes', () => {
    expect(
      layout({
        hidden: ['counts'],
        order: ['myTasks', 'activity', 'counts'],
        settings: { activity: { span: 6, density: 'compact' } },
      }),
    ).toBe(true);
  });

  it('accepts clearing: it is the return to the role default', () => {
    expect(layout(null)).toBe(true);
  });

  it('refuses a block the screen could not render', () => {
    expect(layout({ order: ['fantome'] })).toBe(false);
  });

  it('lets the other keys of the bag through without looking at them', () => {
    expect(preferencesPatchSchema.safeParse({ density: 'compact' }).success).toBe(true);
  });
});

describe('updatePreferences: the layout is indeed persisted', () => {
  it('writes the key without touching the rest of the bag', async () => {
    stored({ density: 'compact' });
    const next = await updatePreferences(7, { projectOverview: { hidden: ['counts'] } });
    expect(next).toEqual({ density: 'compact', projectOverview: { hidden: ['counts'] } });
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it('removes the key when the person returns to their role default', async () => {
    stored({ density: 'compact', projectOverview: { hidden: ['counts'] } });
    const next = await updatePreferences(7, { projectOverview: null });
    expect(next).toEqual({ density: 'compact' });
  });
});
