// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { filterPeople, personLabel, personMatches, personSubtitle, type PersonOption } from './peopleSearch';

const person = (over: Partial<PersonOption> & { id: number }): PersonOption => ({
  name: 'Anonyme',
  email: `u${over.id}@studio.io`,
  ...over,
});

// Le cas qui a motivé l'écran : des homonymes que seule l'adresse départage.
const heloise = person({ id: 1, name: 'Héloïse Marchand', email: 'heloise@studio.io' });
const artistA = person({ id: 2, name: 'IT Artist', email: 'anna@studio.io', jobTitle: 'Lighting' });
const artistB = person({ id: 3, name: 'IT Artist', email: 'bruno@studio.io', role: 'ADMIN' });
const bot = person({ id: 4, name: 'Farm bot', email: 'farm@studio.io', isService: true });
const roster = [artistB, bot, artistA, heloise];

describe('personMatches', () => {
  it('ignore la casse et les accents', () => {
    expect(personMatches(heloise, 'HELOISE')).toBe(true);
    expect(personMatches(heloise, 'ïse mar')).toBe(true);
    expect(personMatches(heloise, 'bruno')).toBe(false);
  });

  it('ignore les espaces de bord et accepte une saisie vide', () => {
    expect(personMatches(heloise, '  marchand  ')).toBe(true);
    expect(personMatches(heloise, '   ')).toBe(true);
  });

  it('cherche aussi dans l’adresse, le poste et le rôle technique', () => {
    expect(personMatches(artistA, 'anna@')).toBe(true);
    expect(personMatches(artistA, 'lighting')).toBe(true);
    expect(personMatches(artistB, 'admin')).toBe(true);
    expect(personMatches(artistA, 'admin')).toBe(false);
  });
});

describe('filterPeople', () => {
  it('écarte les comptes de service, sauf demande explicite', () => {
    expect(filterPeople(roster).map((p) => p.id)).not.toContain(bot.id);
    expect(filterPeople(roster, { includeService: true }).map((p) => p.id)).toContain(bot.id);
  });

  it('écarte les personnes déjà retenues', () => {
    expect(filterPeople(roster, { excludeIds: [artistA.id, heloise.id] }).map((p) => p.id)).toEqual([
      artistB.id,
    ]);
  });

  it('départage deux homonymes par l’adresse saisie', () => {
    expect(filterPeople(roster, { query: 'artist bruno' })).toEqual([]);
    expect(filterPeople(roster, { query: 'bruno' }).map((p) => p.id)).toEqual([artistB.id]);
  });

  it('ordonne par nom puis par adresse — deux homonymes ne changent pas de place', () => {
    expect(filterPeople(roster).map((p) => p.email)).toEqual([
      'heloise@studio.io',
      'anna@studio.io',
      'bruno@studio.io',
    ]);
    // Même liste dans un autre ordre d'entrée : le résultat ne bouge pas.
    expect(filterPeople([...roster].reverse()).map((p) => p.email)).toEqual([
      'heloise@studio.io',
      'anna@studio.io',
      'bruno@studio.io',
    ]);
  });

  it('ne modifie pas la liste reçue', () => {
    const source = [...roster];
    filterPeople(source);
    expect(source).toEqual(roster);
  });

  it('rend tout le monde quand la saisie est vide', () => {
    expect(filterPeople(roster, { query: '' })).toHaveLength(3);
  });
});

describe('personLabel', () => {
  it('préfère le nom calculé par le serveur, puis le pseudo, puis le nom', () => {
    expect(personLabel({ displayName: 'Anna L.', username: 'anna', email: 'a@x.io' })).toBe('Anna L.');
    expect(personLabel({ username: 'anna', name: 'Anna Lopez', email: 'a@x.io' })).toBe('anna');
    expect(personLabel({ name: 'Anna Lopez', email: 'a@x.io' })).toBe('Anna Lopez');
  });

  it('retombe sur l’adresse plutôt que sur une ligne vide', () => {
    expect(personLabel({ email: 'invite@studio.io' })).toBe('invite@studio.io');
    expect(personLabel({ displayName: null, username: null, name: null, email: 'a@x.io' })).toBe('a@x.io');
  });
});

describe('personSubtitle', () => {
  it('joint le poste et l’adresse', () => {
    expect(personSubtitle(artistA)).toBe('Lighting · anna@studio.io');
  });

  it('n’affiche pas de séparateur orphelin', () => {
    expect(personSubtitle(heloise)).toBe('heloise@studio.io');
    expect(personSubtitle(person({ id: 9, email: null, jobTitle: 'Compositing' }))).toBe('Compositing');
    expect(personSubtitle(person({ id: 9, email: null }))).toBe('');
  });
});
