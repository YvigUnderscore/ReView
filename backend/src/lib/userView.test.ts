// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('./storage', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));

import { displayName, initials, toSessionUser, toPublicUserOrDeleted, DELETED_USER_VIEW } from './userView';

describe('displayName', () => {
  it('prioritizes the username', () => {
    expect(displayName({ id: 1, email: 'e@x.io', username: 'jdoe', name: 'John' })).toBe('jdoe');
  });
  it('falls back to the legacy full name', () => {
    expect(displayName({ id: 1, email: 'e@x.io', name: 'John Doe' })).toBe('John Doe');
  });
  it('combines first name + last name', () => {
    expect(displayName({ id: 1, email: 'e@x.io', firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
  });
  it('falls back to the email as a last resort', () => {
    expect(displayName({ id: 1, email: 'a@b.c' })).toBe('a@b.c');
  });
});

describe('toSessionUser', () => {
  // The session view is what the front end replays on each reload: a field missing here
  // disappears from the profile screen, and the save looks as if nothing was kept.
  it('carries the enriched profile (job title, bio, phone)', async () => {
    const view = await toSessionUser({
      id: 1,
      email: 'e@x.io',
      username: 'jdoe',
      jobTitle: 'Compositing',
      bio: 'Bonjour',
      phone: '+33 6',
      role: 'ARTIST',
      status: 'AVAILABLE',
    });
    expect(view).toMatchObject({
      displayName: 'jdoe',
      jobTitle: 'Compositing',
      bio: 'Bonjour',
      phone: '+33 6',
      role: 'ARTIST',
    });
  });

  it('normalizes empty fields to null rather than omitting them', async () => {
    const view = await toSessionUser({ id: 1, email: 'e@x.io', role: 'ARTIST' });
    expect(view.jobTitle).toBeNull();
    expect(view.bio).toBeNull();
    expect(view.phone).toBeNull();
  });
});

describe('initials', () => {
  it('combines first name + last name', () => {
    expect(initials({ id: 1, email: 'e@x.io', firstName: 'John', lastName: 'Doe' })).toBe('JD');
  });
  it('derives two initials from a two-word name', () => {
    expect(initials({ id: 1, email: 'e@x.io', name: 'Jane Roe' })).toBe('JR');
  });
  it('takes the first two letters for a single-word name', () => {
    expect(initials({ id: 1, email: 'e@x.io', name: 'Madonna' })).toBe('MA');
  });
});

/**
 * Two different ways of having no account, which must not be confused: the deleted account
 * (nothing left behind it) and the person who never had one here but whose name we know: a guest,
 * or a contributor who came from ShotGrid.
 */
describe('toPublicUserOrDeleted', () => {
  it('returns the author when they have an account', async () => {
    const vue = (await toPublicUserOrDeleted({ id: 3, email: 'a@x.io', username: 'ana' })) as {
      displayName: string;
    };
    expect(vue.displayName).toBe('ana');
  });

  it('reports a deleted account when nothing remains', async () => {
    expect(await toPublicUserOrDeleted(null)).toEqual(DELETED_USER_VIEW);
    expect(await toPublicUserOrDeleted(null, null)).toEqual(DELETED_USER_VIEW);
    expect(await toPublicUserOrDeleted(null, '')).toEqual(DELETED_USER_VIEW);
  });

  it('yields to an external name instead of burying a living person', async () => {
    // This is the case that displayed "compte supprimé" in place of the supervisor who wrote the
    // note in ShotGrid: the API fabricated an author, so the name kept on the comment was never
    // consulted.
    expect(await toPublicUserOrDeleted(null, 'Yvig Bidon')).toBeNull();
  });

  it('the real account takes precedence over the external name', async () => {
    const vue = (await toPublicUserOrDeleted({ id: 3, email: 'a@x.io', username: 'ana' }, 'Autre')) as {
      displayName: string;
    };
    expect(vue.displayName).toBe('ana');
  });
});
