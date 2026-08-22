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
  it('range les scopes par domaine dans l’ordre servi', () => {
    const { domains, standalone } = groupScopes(CATALOG);
    expect(domains).toEqual([
      { domain: 'projects', read: 'projects:read', write: null },
      { domain: 'versions', read: 'versions:read', write: 'versions:write' },
    ]);
    expect(standalone).toEqual([ADMIN_SCOPE]);
  });

  // Une case en trop vaut mieux qu'un droit invisible.
  it('isole un scope inconnu plutôt que de le perdre', () => {
    expect(groupScopes(['weird', 'versions:purge']).standalone).toEqual(['weird', 'versions:purge']);
  });

  it('ne duplique pas un scope global servi deux fois', () => {
    expect(groupScopes(['admin', 'admin']).standalone).toEqual([ADMIN_SCOPE]);
  });
});

describe('toggleScope', () => {
  it('accorde la lecture avec l’écriture (ce que le serveur ferait de toute façon)', () => {
    expect(toggleScope([], 'versions:write', true).sort()).toEqual(['versions:read', 'versions:write']);
  });

  it('retire l’écriture quand on retire la lecture', () => {
    expect(toggleScope(['versions:read', 'versions:write'], 'versions:read', false)).toEqual([]);
  });

  it('laisse l’écriture d’un autre domaine intacte', () => {
    const next = toggleScope(['shots:read', 'versions:read', 'versions:write'], 'versions:read', false);
    expect(next).toEqual(['shots:read']);
  });

  it('rend `admin` exclusif', () => {
    expect(toggleScope(['versions:read'], ADMIN_SCOPE, true)).toEqual([ADMIN_SCOPE]);
    expect(toggleScope([ADMIN_SCOPE], ADMIN_SCOPE, false)).toEqual([]);
  });

  it('abandonne `admin` dès qu’on coche un scope fin', () => {
    expect(toggleScope([ADMIN_SCOPE], 'shots:read', true)).toEqual(['shots:read']);
  });
});

describe('isScopeOn', () => {
  it('coche tout sous `admin`', () => {
    expect(isScopeOn([ADMIN_SCOPE], 'versions:write')).toBe(true);
    expect(isScopeOn([ADMIN_SCOPE], ADMIN_SCOPE)).toBe(true);
  });

  it('ne coche que ce qui est accordé sinon', () => {
    expect(isScopeOn(['versions:read'], 'versions:write')).toBe(false);
    expect(isScopeOn(['versions:read'], 'versions:read')).toBe(true);
  });
});

describe('scopeLevel', () => {
  it('reconnaît les trois niveaux, scopes hérités compris', () => {
    expect(scopeLevel(['admin'])).toBe('admin');
    expect(scopeLevel(['write'])).toBe('write');
    expect(scopeLevel(['versions:write', 'shots:read'])).toBe('write');
    expect(scopeLevel(['read', 'shots:read'])).toBe('read');
  });
});

describe('expiryDays', () => {
  it('traduit le choix en jours, sans expiration par défaut', () => {
    expect(expiryDays('90')).toBe(90);
    expect(expiryDays('')).toBeUndefined();
    expect(expiryDays('0')).toBeUndefined();
    expect(expiryDays('jamais')).toBeUndefined();
  });
});

describe('buildTokenDraft', () => {
  it('refuse un brouillon sans nom ou sans scope', () => {
    expect(buildTokenDraft({ name: '   ', scopes: ['read'] })).toBeNull();
    expect(buildTokenDraft({ name: 'Farm', scopes: [] })).toBeNull();
  });

  it('n’envoie que les champs renseignés', () => {
    expect(buildTokenDraft({ name: '  Farm  ', scopes: ['read'] })).toEqual({
      name: 'Farm',
      scopes: ['read'],
    });
  });

  it('porte cantonnement, expiration, description et mot de passe', () => {
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

  it('traite « tous les projets » comme une absence de cantonnement', () => {
    const draft = buildTokenDraft({ name: 'Farm', scopes: ['read'], projectId: '', expiry: '' });
    expect(draft).not.toHaveProperty('projectId');
    expect(draft).not.toHaveProperty('expiresInDays');
  });
});
