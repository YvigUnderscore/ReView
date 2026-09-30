// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));

import { displayName, initials, toSessionUser, toPublicUserOrDeleted, DELETED_USER_VIEW } from './userView';

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

describe('toSessionUser', () => {
  // La vue de session est ce que le front rejoue à chaque rechargement : un champ absent
  // ici disparaît de l'écran de profil, et la sauvegarde a l'air de n'avoir rien gardé.
  it('emporte le profil enrichi (poste, bio, téléphone)', async () => {
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

  it('normalise les champs vides à null plutôt que de les omettre', async () => {
    const view = await toSessionUser({ id: 1, email: 'e@x.io', role: 'ARTIST' });
    expect(view.jobTitle).toBeNull();
    expect(view.bio).toBeNull();
    expect(view.phone).toBeNull();
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

/**
 * Deux façons différentes de n'avoir pas de compte, qu'il ne faut pas confondre : le
 * compte supprimé (plus rien derrière lui) et la personne qui n'en a jamais eu ici mais
 * dont on connaît le nom — invité, ou intervenant venu de ShotGrid.
 */
describe('toPublicUserOrDeleted', () => {
  it("rend l'auteur quand il a un compte", async () => {
    const vue = (await toPublicUserOrDeleted({ id: 3, email: 'a@x.io', username: 'ana' })) as {
      displayName: string;
    };
    expect(vue.displayName).toBe('ana');
  });

  it('annonce un compte supprimé quand rien ne subsiste', async () => {
    expect(await toPublicUserOrDeleted(null)).toEqual(DELETED_USER_VIEW);
    expect(await toPublicUserOrDeleted(null, null)).toEqual(DELETED_USER_VIEW);
    expect(await toPublicUserOrDeleted(null, '')).toEqual(DELETED_USER_VIEW);
  });

  it("s'efface devant un nom externe, au lieu d'enterrer un vivant", async () => {
    // C'est ce cas qui affichait « compte supprimé » à la place du superviseur ayant
    // écrit la note dans ShotGrid : l'API fabriquait un auteur, donc le nom conservé
    // sur le commentaire n'était jamais consulté.
    expect(await toPublicUserOrDeleted(null, 'Yvig Bidon')).toBeNull();
  });

  it("le compte réel l'emporte sur le nom externe", async () => {
    const vue = (await toPublicUserOrDeleted({ id: 3, email: 'a@x.io', username: 'ana' }, 'Autre')) as {
      displayName: string;
    };
    expect(vue.displayName).toBe('ana');
  });
});
