// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { expandScopes, hasScope, isGrantableScope, ALL_SCOPES, SCOPE_DOMAINS } from './apiScopes';

describe('expandScopes', () => {
  it('expands the legacy read scope into read-only scopes', () => {
    const granted = expandScopes(['read']);
    expect(granted.has('versions:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(false);
  });

  it('expands the legacy write scope into read + write scopes', () => {
    const granted = expandScopes(['write']);
    expect(granted.has('versions:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(true);
    expect(granted.has('media:write')).toBe(true);
  });

  it('does not invent a write for a domain declared read-only', () => {
    const granted = expandScopes(['write']);
    expect(granted.has('projects:read')).toBe(true);
    expect([...granted].some((s) => s.startsWith('projects:write'))).toBe(false);
    expect([...granted].some((s) => s.startsWith('events:write'))).toBe(false);
  });

  it('infers read for a domain whose write is granted', () => {
    const granted = expandScopes(['comments:write']);
    expect(granted.has('comments:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(false);
  });

  it('admin covers every scope', () => {
    const granted = expandScopes(['admin']);
    for (const s of ALL_SCOPES) expect(granted.has(s)).toBe(true);
  });

  it('ignores unknown scopes without throwing', () => {
    expect(expandScopes(['pas-un-scope']).size).toBe(0);
  });

  /**
   * A token issued before the catalogue clean-up still carries `playlists:read` or `users:write` in
   * the database. It must remain usable: those scopes guarded no route, so ignoring them removes
   * nothing from it.
   */
  it('ignores a scope removed from the catalogue without invalidating the rest of the token', () => {
    const granted = expandScopes(['playlists:read', 'users:write', 'tasks:read']);
    expect(granted.has('tasks:read')).toBe(true);
    expect(granted.size).toBe(1);
    expect(hasScope(['webhooks:write', 'write'], 'versions:write')).toBe(true);
  });
});

describe('catalogue', () => {
  it('declares only scopes actually required by a route', () => {
    expect([...SCOPE_DOMAINS].sort()).toEqual([
      'assets',
      'comments',
      'episodes',
      'events',
      'media',
      'projects',
      'sequences',
      'shots',
      'tasks',
      'versions',
    ]);
    expect(ALL_SCOPES).toContain('media:write');
    for (const removed of [
      'projects:write',
      'events:write',
      'playlists:read',
      'playlists:write',
      'webhooks:read',
      'webhooks:write',
      'users:read',
      'users:write',
    ]) {
      expect(ALL_SCOPES as readonly string[]).not.toContain(removed);
      expect(isGrantableScope(removed)).toBe(false);
    }
  });
});

describe('hasScope', () => {
  it('grants the exact scope and the admin pass', () => {
    expect(hasScope(['tasks:write'], 'tasks:write')).toBe(true);
    expect(hasScope(['admin'], 'media:write')).toBe(true);
    expect(hasScope(['tasks:read'], 'tasks:write')).toBe(false);
    expect(hasScope([], 'projects:read')).toBe(false);
  });
});

describe('isGrantableScope', () => {
  it('accepts fine-grained and legacy scopes, refuses the rest', () => {
    expect(isGrantableScope('versions:write')).toBe(true);
    expect(isGrantableScope('read')).toBe(true);
    expect(isGrantableScope('admin')).toBe(true);
    expect(isGrantableScope('versions:delete')).toBe(false);
    expect(isGrantableScope('')).toBe(false);
  });
});
