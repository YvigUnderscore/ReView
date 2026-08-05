// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { expandScopes, hasScope, isGrantableScope, scopeFor, ALL_SCOPES } from './apiScopes';

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
  });

  it("n'accorde jamais la gestion des webhooks ni l'annuaire via les scopes hérités", () => {
    const granted = expandScopes(['write']);
    expect(granted.has('webhooks:write')).toBe(false);
    expect(granted.has('webhooks:read')).toBe(false);
    expect(granted.has('users:read')).toBe(false);
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
});

describe('hasScope', () => {
  it('accorde le scope exact et le laissez-passer admin', () => {
    expect(hasScope(['tasks:write'], 'tasks:write')).toBe(true);
    expect(hasScope(['admin'], 'webhooks:write')).toBe(true);
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

describe('scopeFor', () => {
  it('mappe la méthode HTTP sur read/write', () => {
    expect(scopeFor('versions', 'GET')).toBe('versions:read');
    expect(scopeFor('versions', 'post')).toBe('versions:write');
    expect(scopeFor('versions', 'DELETE')).toBe('versions:write');
  });
});
