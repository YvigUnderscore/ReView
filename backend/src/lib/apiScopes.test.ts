// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { expandScopes, hasScope, isGrantableScope, ALL_SCOPES, SCOPE_DOMAINS } from './apiScopes';

describe('expandScopes', () => {
  it('développe le scope hérité read en lectures seules', () => {
    const granted = expandScopes(['read']);
    expect(granted.has('versions:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(false);
  });

  it('développe le scope hérité write en lectures + écritures', () => {
    const granted = expandScopes(['write']);
    expect(granted.has('versions:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(true);
    expect(granted.has('media:write')).toBe(true);
  });

  it('n’invente pas d’écriture pour un domaine déclaré en lecture seule', () => {
    const granted = expandScopes(['write']);
    expect(granted.has('projects:read')).toBe(true);
    expect([...granted].some((s) => s.startsWith('projects:write'))).toBe(false);
    expect([...granted].some((s) => s.startsWith('events:write'))).toBe(false);
  });

  it('déduit la lecture d’un domaine dont l’écriture est accordée', () => {
    const granted = expandScopes(['comments:write']);
    expect(granted.has('comments:read')).toBe(true);
    expect(granted.has('versions:write')).toBe(false);
  });

  it('admin couvre tous les scopes', () => {
    const granted = expandScopes(['admin']);
    for (const s of ALL_SCOPES) expect(granted.has(s)).toBe(true);
  });

  it('ignore les scopes inconnus sans lever', () => {
    expect(expandScopes(['pas-un-scope']).size).toBe(0);
  });

  /**
   * Un token émis avant le nettoyage du catalogue porte encore `playlists:read` ou
   * `users:write` en base. Il doit rester utilisable : ces scopes ne gardaient aucune
   * route, les ignorer ne lui retire donc rien.
   */
  it('ignore un scope retiré du catalogue sans invalider le reste du token', () => {
    const granted = expandScopes(['playlists:read', 'users:write', 'tasks:read']);
    expect(granted.has('tasks:read')).toBe(true);
    expect(granted.size).toBe(1);
    expect(hasScope(['webhooks:write', 'write'], 'versions:write')).toBe(true);
  });
});

describe('catalogue', () => {
  it('ne déclare que des scopes réellement exigés par une route', () => {
    expect([...SCOPE_DOMAINS].sort()).toEqual([
      'assets',
      'comments',
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
  it('accorde le scope exact et le laissez-passer admin', () => {
    expect(hasScope(['tasks:write'], 'tasks:write')).toBe(true);
    expect(hasScope(['admin'], 'media:write')).toBe(true);
    expect(hasScope(['tasks:read'], 'tasks:write')).toBe(false);
    expect(hasScope([], 'projects:read')).toBe(false);
  });
});

describe('isGrantableScope', () => {
  it('accepte scopes fins et hérités, refuse le reste', () => {
    expect(isGrantableScope('versions:write')).toBe(true);
    expect(isGrantableScope('read')).toBe(true);
    expect(isGrantableScope('admin')).toBe(true);
    expect(isGrantableScope('versions:delete')).toBe(false);
    expect(isGrantableScope('')).toBe(false);
  });
});
