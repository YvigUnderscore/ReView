// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { displayName, initials } from './userView';

describe('displayName', () => {
  it('priorise le pseudo', () => {
    expect(displayName({ id: 1, email: 'e@x.io', username: 'jdoe', name: 'John' })).toBe('jdoe');
  });
  it('retombe sur le nom complet legacy', () => {
    expect(displayName({ id: 1, email: 'e@x.io', name: 'John Doe' })).toBe('John Doe');
  });
  it('compose prénom + nom', () => {
    expect(displayName({ id: 1, email: 'e@x.io', firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
  });
  it("retombe sur l'email en dernier recours", () => {
    expect(displayName({ id: 1, email: 'a@b.c' })).toBe('a@b.c');
  });
});

describe('initials', () => {
  it('combine prénom + nom', () => {
    expect(initials({ id: 1, email: 'e@x.io', firstName: 'John', lastName: 'Doe' })).toBe('JD');
  });
  it("dérive deux initiales d'un nom à deux mots", () => {
    expect(initials({ id: 1, email: 'e@x.io', name: 'Jane Roe' })).toBe('JR');
  });
  it('prend les deux premières lettres pour un nom à un mot', () => {
    expect(initials({ id: 1, email: 'e@x.io', name: 'Madonna' })).toBe('MA');
  });
});
