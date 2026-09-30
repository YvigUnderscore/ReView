// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `auditLog` : depuis A5-03, chaque tentative de connexion écrit sa trace. Le double doit
// rendre une promesse — `logAudit` détache l'écriture et lui accroche un `.catch`.
const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, auditLog: { create: vi.fn().mockResolvedValue({}) } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => ({
  createSession: vi.fn().mockResolvedValue('sid-1'),
  isSessionActive: vi.fn().mockResolvedValue(true),
  touchSession: vi.fn(),
}));
vi.mock('../lib/oidcConfig', () => ({ isPasswordLoginBlocked: vi.fn().mockResolvedValue(false) }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../middleware/auth', () => ({ authenticate: vi.fn() }));

import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import authRoutes from './auth.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/auth', authRoutes).use(errorHandler);

// Coût 4 : ces tests mesurent le comptage, pas la résistance du hash.
const HASH = bcrypt.hashSync('Motdepasse1', 4);

const login = (email: string, password = 'MauvaisMdp1') =>
  request(app).post('/api/auth/login').send({ email, password });

beforeEach(() => {
  db.user.findUnique.mockResolvedValue({
    id: 7,
    email: 'alice@studio.com',
    password: HASH,
    role: 'ARTIST',
    isService: false,
    totpEnabledAt: null,
    disabledAt: null,
  });
});

/**
 * A5-02 — un limiteur unique de 50 coups / 15 min indexé sur l'IP ne bornait rien.
 *
 * Deux effets, tous deux atteignables. Côté sécurité : un attaquant qui répartit ses essais
 * sur cent adresses sources obtient cinq mille tentatives par quart d'heure sur un compte
 * unique, sans jamais déclencher de verrouillage. Côté disponibilité : un studio de cinquante
 * personnes sort par une seule IP publique, et le cinquante-et-unième arrivant du matin
 * reçoit 429 sans qu'aucun mot de passe ne soit faux.
 *
 * Le compteur du frein par compte est de process sous `NODE_ENV=test` (cf. rateLimit.ts) et
 * vit dans le module de la route : il se remplit d'un test à l'autre de ce fichier, ce qui
 * est exactement ce qu'on veut mesurer ici.
 */
describe('POST /api/auth/login — frein par compte (A5-02)', () => {
  it('borne les essais visant une adresse donnée, puis refuse en 429', async () => {
    // Le plafond par compte est de dix : les dix premiers essais sont des refus ordinaires.
    for (let i = 0; i < 10; i += 1) {
      expect((await login('alice@studio.com')).status).toBe(401);
    }
    const blocked = await login('alice@studio.com');
    expect(blocked.status).toBe(429);
  });

  // La clé est l'adresse VISÉE, pas la source : un autre compte attaqué depuis la même
  // machine garde son propre budget — et réciproquement, changer de machine ne rouvre rien.
  it('ne pénalise pas un autre compte depuis la même source', async () => {
    const other = await login('bob@studio.com');
    expect(other.status).toBe(401);
  });

  // L'adresse est normalisée avant de servir de clé : sans cela, alterner les majuscules
  // offrait un compteur neuf à chaque essai, c'est-à-dire aucun frein du tout.
  it('ne se laisse pas contourner par la casse de l’adresse', async () => {
    const blocked = await login('ALICE@Studio.com');
    expect(blocked.status).toBe(429);
  });
});
