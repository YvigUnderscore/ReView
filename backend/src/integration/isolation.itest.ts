// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ITEST_DATABASE_SUFFIX } from './itestEnv';

/**
 * Les propriétés d'isolation de la suite d'intégration, vérifiées par la suite elle-même.
 *
 * Elles ne se voient pas dans les autres fichiers : ceux-ci passeraient tout aussi bien sur
 * la base de développement, ou en recevant des 429 à la place de leurs assertions. Ce
 * fichier est là pour qu'une régression de la plomberie soit rouge, et rouge ici.
 */
const app = createApp({ rateLimit: false });

describe('Intégration — isolation de la base', () => {
  it('la suite écrit dans une base jetable, jamais dans celle de développement', async () => {
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    expect(rows[0]?.current_database.endsWith(ITEST_DATABASE_SUFFIX)).toBe(true);
  });

  it('la base a été remise à neuf : aucune trace des exécutions précédentes', async () => {
    // `globalSetup` rejoue les migrations sur une base vide. Les seuls comptes présents
    // sont donc ceux que la suite vient de créer — il n'y en avait aucun au démarrage.
    const leftovers = await prisma.user.count({ where: { email: { startsWith: 'it-artist-' } } });
    expect(leftovers).toBeLessThanOrEqual(1);
  });
});

describe('Intégration — limiteurs neutralisés (createApp({ rateLimit: false }))', () => {
  it('un limiteur monté par createApp ne compte plus (/api/setup, plafond 10 / 15 min)', async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 15; i += 1) {
      codes.add((await request(app).get('/api/setup/status')).status);
    }
    expect([...codes]).not.toContain(429);
  });

  it("un limiteur construit à l'import d'un routeur ne compte plus (/api/unsubscribe, plafond 60 / 15 min)", async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 70; i += 1) {
      codes.add((await request(app).get('/api/unsubscribe/not-a-valid-token')).status);
    }
    expect([...codes]).not.toContain(429);
  });

  it("l'option est refusée hors NODE_ENV=test : aucune instance ne peut se retrouver sans limiteur", () => {
    const mutable = env as { NODE_ENV: string };
    const saved = mutable.NODE_ENV;
    mutable.NODE_ENV = 'production';
    try {
      expect(() => createApp({ rateLimit: false })).toThrow(/NODE_ENV=test/);
    } finally {
      mutable.NODE_ENV = saved;
    }
  });
});
