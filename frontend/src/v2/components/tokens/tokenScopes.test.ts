// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ADMIN_SCOPE,
  buildTokenDraft,
  expiryDays,
  groupScopes,
  isScopeOn,
  scopeLevel,
  toggleScope,
} from './tokenScopes';

const CATALOG = ['projects:read', 'versions:read', 'versions:write', 'admin'];

describe('groupScopes', () => {
  it('groups the scopes by domain in the order served', () => {
    const { domains, standalone } = groupScopes(CATALOG);
    expect(domains).toEqual([
      { domain: 'projects', read: 'projects:read', write: null },
      { domain: 'versions', read: 'versions:read', write: 'versions:write' },
    ]);
    expect(standalone).toEqual([ADMIN_SCOPE]);
  });

  // An extra checkbox is better than an invisible right.
  it('isolates an unknown scope rather than losing it', () => {
    expect(groupScopes(['weird', 'versions:purge']).standalone).toEqual(['weird', 'versions:purge']);
  });

  it('does not duplicate a global scope served twice', () => {
    expect(groupScopes(['admin', 'admin']).standalone).toEqual([ADMIN_SCOPE]);
  });
});

describe('toggleScope', () => {
  it('grants read along with write (what the server would do anyway)', () => {
    expect(toggleScope([], 'versions:write', true).sort()).toEqual(['versions:read', 'versions:write']);
  });

  it('removes write when read is removed', () => {
    expect(toggleScope(['versions:read', 'versions:write'], 'versions:read', false)).toEqual([]);
  });

  it('leaves the write of another domain intact', () => {
    const next = toggleScope(['shots:read', 'versions:read', 'versions:write'], 'versions:read', false);
    expect(next).toEqual(['shots:read']);
  });

  it('makes `admin` exclusive', () => {
    expect(toggleScope(['versions:read'], ADMIN_SCOPE, true)).toEqual([ADMIN_SCOPE]);
    expect(toggleScope([ADMIN_SCOPE], ADMIN_SCOPE, false)).toEqual([]);
  });

  it('drops `admin` as soon as a fine-grained scope is ticked', () => {
    expect(toggleScope([ADMIN_SCOPE], 'shots:read', true)).toEqual(['shots:read']);
  });
});

describe('isScopeOn', () => {
  it('ticks everything under `admin`', () => {
    expect(isScopeOn([ADMIN_SCOPE], 'versions:write')).toBe(true);
    expect(isScopeOn([ADMIN_SCOPE], ADMIN_SCOPE)).toBe(true);
  });

  it('otherwise only ticks what is granted', () => {
    expect(isScopeOn(['versions:read'], 'versions:write')).toBe(false);
    expect(isScopeOn(['versions:read'], 'versions:read')).toBe(true);
  });
});

describe('scopeLevel', () => {
  it('recognises the three levels, legacy scopes included', () => {
    expect(scopeLevel(['admin'])).toBe('admin');
    expect(scopeLevel(['write'])).toBe('write');
    expect(scopeLevel(['versions:write', 'shots:read'])).toBe('write');
    expect(scopeLevel(['read', 'shots:read'])).toBe('read');
  });
});

describe('expiryDays', () => {
  it('translates the choice into days, with no expiry by default', () => {
    expect(expiryDays('90')).toBe(90);
    expect(expiryDays('')).toBeUndefined();
    expect(expiryDays('0')).toBeUndefined();
    expect(expiryDays('jamais')).toBeUndefined();
  });
});

describe('buildTokenDraft', () => {
  it('rejects a draft without a name or without a scope', () => {
    expect(buildTokenDraft({ name: '   ', scopes: ['read'] })).toBeNull();
    expect(buildTokenDraft({ name: 'Farm', scopes: [] })).toBeNull();
  });

  it('only sends the fields filled in', () => {
    expect(buildTokenDraft({ name: '  Farm  ', scopes: ['read'] })).toEqual({
      name: 'Farm',
      scopes: ['read'],
    });
  });

  it('carries restriction, expiry, description and password', () => {
    expect(
      buildTokenDraft({
        name: 'Render farm',
        description: ' nightly ',
        scopes: ['versions:write'],
        projectId: '4',
        expiry: '30',
        currentPassword: 'Motdepasse1',
      }),
    ).toEqual({
      name: 'Render farm',
      description: 'nightly',
      scopes: ['versions:write'],
      projectId: 4,
      expiresInDays: 30,
      currentPassword: 'Motdepasse1',
    });
  });

  it('treats "all projects" as no restriction', () => {
    const draft = buildTokenDraft({ name: 'Farm', scopes: ['read'], projectId: '', expiry: '' });
    expect(draft).not.toHaveProperty('projectId');
    expect(draft).not.toHaveProperty('expiresInDays');
  });
});
