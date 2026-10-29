// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  emptyPeopleReason,
  filterPeople,
  personLabel,
  personMatches,
  personSubtitle,
  type PersonOption,
} from './peopleSearch';

const person = (over: Partial<PersonOption> & { id: number }): PersonOption => ({
  name: 'Anonyme',
  email: `u${over.id}@studio.io`,
  ...over,
});

// The case that motivated the screen: namesakes that only the email address tells apart.
const heloise = person({ id: 1, name: 'Héloïse Marchand', email: 'heloise@studio.io' });
const artistA = person({ id: 2, name: 'IT Artist', email: 'anna@studio.io', jobTitle: 'Lighting' });
const artistB = person({ id: 3, name: 'IT Artist', email: 'bruno@studio.io', role: 'ADMIN' });
const bot = person({ id: 4, name: 'Farm bot', email: 'farm@studio.io', isService: true });
const roster = [artistB, bot, artistA, heloise];

describe('personMatches', () => {
  it('ignores case and accents', () => {
    expect(personMatches(heloise, 'HELOISE')).toBe(true);
    expect(personMatches(heloise, 'ïse mar')).toBe(true);
    expect(personMatches(heloise, 'bruno')).toBe(false);
  });

  it('ignores surrounding spaces and accepts an empty input', () => {
    expect(personMatches(heloise, '  marchand  ')).toBe(true);
    expect(personMatches(heloise, '   ')).toBe(true);
  });

  it('also searches the email address, job title and technical role', () => {
    expect(personMatches(artistA, 'anna@')).toBe(true);
    expect(personMatches(artistA, 'lighting')).toBe(true);
    expect(personMatches(artistB, 'admin')).toBe(true);
    expect(personMatches(artistA, 'admin')).toBe(false);
  });
});

describe('filterPeople', () => {
  it('excludes service accounts unless explicitly requested', () => {
    expect(filterPeople(roster).map((p) => p.id)).not.toContain(bot.id);
    expect(filterPeople(roster, { includeService: true }).map((p) => p.id)).toContain(bot.id);
  });

  it('excludes people already selected', () => {
    expect(filterPeople(roster, { excludeIds: [artistA.id, heloise.id] }).map((p) => p.id)).toEqual([
      artistB.id,
    ]);
  });

  it('tells apart two namesakes by the email address typed', () => {
    expect(filterPeople(roster, { query: 'artist bruno' })).toEqual([]);
    expect(filterPeople(roster, { query: 'bruno' }).map((p) => p.id)).toEqual([artistB.id]);
  });

  it('orders by name then by email — two namesakes do not swap places', () => {
    expect(filterPeople(roster).map((p) => p.email)).toEqual([
      'heloise@studio.io',
      'anna@studio.io',
      'bruno@studio.io',
    ]);
    // Same list in another input order: the result does not move.
    expect(filterPeople([...roster].reverse()).map((p) => p.email)).toEqual([
      'heloise@studio.io',
      'anna@studio.io',
      'bruno@studio.io',
    ]);
  });

  it('does not modify the list received', () => {
    const source = [...roster];
    filterPeople(source);
    expect(source).toEqual(roster);
  });

  it('returns everyone when the input is empty', () => {
    expect(filterPeople(roster, { query: '' })).toHaveLength(3);
  });
});

describe('personLabel', () => {
  it('prefers the name computed by the server, then the nickname, then the name', () => {
    expect(personLabel({ displayName: 'Anna L.', username: 'anna', email: 'a@x.io' })).toBe('Anna L.');
    expect(personLabel({ username: 'anna', name: 'Anna Lopez', email: 'a@x.io' })).toBe('anna');
    expect(personLabel({ name: 'Anna Lopez', email: 'a@x.io' })).toBe('Anna Lopez');
  });

  it('falls back to the email address rather than an empty line', () => {
    expect(personLabel({ email: 'invite@studio.io' })).toBe('invite@studio.io');
    expect(personLabel({ displayName: null, username: null, name: null, email: 'a@x.io' })).toBe('a@x.io');
  });
});

describe('personSubtitle', () => {
  it('joins the job title and the email address', () => {
    expect(personSubtitle(artistA)).toBe('Lighting · anna@studio.io');
  });

  it('does not display an orphan separator', () => {
    expect(personSubtitle(heloise)).toBe('heloise@studio.io');
    expect(personSubtitle(person({ id: 9, email: null, jobTitle: 'Compositing' }))).toBe('Compositing');
    expect(personSubtitle(person({ id: 9, email: null }))).toBe('');
  });
});

/**
 * The defect seen on screen: on a studio where everyone is already a member, the add dialog displayed
 * "No one matches this search" while the field was empty — it blamed a search nobody had made.
 */
describe('emptyPeopleReason', () => {
  it('without a search, an empty list means there is nobody to offer', () => {
    expect(emptyPeopleReason('')).toBe('no-candidates');
  });

  it('spaces are not a search', () => {
    expect(emptyPeopleReason('   ')).toBe('no-candidates');
    expect(emptyPeopleReason('\t\n')).toBe('no-candidates');
  });

  it('as soon as a word is typed, the empty list does speak of a match', () => {
    expect(emptyPeopleReason('a')).toBe('no-match');
    expect(emptyPeopleReason('  héloïse  ')).toBe('no-match');
  });
});
