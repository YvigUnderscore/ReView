import { describe, it, expect } from 'vitest';
import { filterUsers, sortUsers, userLabel } from './adminUsers';
import type { User } from '../../types/api';

const user = (over: Partial<User>): User => ({
  id: 1,
  email: 'a@studio.fr',
  name: null,
  firstName: null,
  lastName: null,
  username: null,
  role: 'ARTIST',
  storageUsed: 0,
  storageLimit: null,
  ...over,
});

const alice = user({ id: 1, email: 'alice@studio.fr', username: 'alice', role: 'ADMIN', storageUsed: 50 });
const bob = user({ id: 2, email: 'bob@studio.fr', name: 'Bob Martin', role: 'ARTIST', storageUsed: 900 });
const chloe = user({
  id: 3,
  email: 'chloe@client.fr',
  displayName: 'Chloé',
  role: 'CLIENT',
  storageUsed: 10,
});

describe('adminUsers — userLabel', () => {
  it('préfère displayName, puis pseudo, nom, email', () => {
    expect(userLabel(chloe)).toBe('Chloé');
    expect(userLabel(alice)).toBe('alice');
    expect(userLabel(bob)).toBe('Bob Martin');
    expect(userLabel(user({ email: 'x@y.z' }))).toBe('x@y.z');
  });
});

describe('adminUsers — filterUsers', () => {
  const all = [alice, bob, chloe];
  it('filtre par rôle et par texte (insensible à la casse)', () => {
    expect(filterUsers(all, '', 'ALL')).toHaveLength(3);
    expect(filterUsers(all, '', 'CLIENT')).toEqual([chloe]);
    expect(filterUsers(all, 'MARTIN', 'ALL')).toEqual([bob]);
    expect(filterUsers(all, 'studio.fr', 'ALL')).toEqual([alice, bob]);
    expect(filterUsers(all, 'martin', 'CLIENT')).toEqual([]);
  });
});

describe('adminUsers — sortUsers', () => {
  const all = [bob, chloe, alice];
  it('trie par nom, rôle, stockage et id décroissant sans muter', () => {
    expect(sortUsers(all, 'name').map((u) => u.id)).toEqual([1, 2, 3]);
    expect(sortUsers(all, 'role').map((u) => u.role)).toEqual(['ADMIN', 'ARTIST', 'CLIENT']);
    expect(sortUsers(all, 'storage').map((u) => u.storageUsed)).toEqual([900, 50, 10]);
    expect(sortUsers(all, 'recent').map((u) => u.id)).toEqual([3, 2, 1]);
    expect(all.map((u) => u.id)).toEqual([2, 3, 1]); // liste d'origine intacte
  });
});
