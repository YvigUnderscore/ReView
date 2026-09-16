// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/crypto', () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
}));
vi.mock('../lib/sessions', () => ({ createSession: vi.fn().mockResolvedValue('sid-1') }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import auth2faRoutes from './auth-2fa.routes';
import { errorHandler } from '../middleware/error';
import { signTwoFaToken } from '../lib/jwt';
import { generateTotpSecret, currentTotp, generateBackupCodes, __testing } from '../lib/twofa';
import { createFakeRedis } from '../lib/redisFake';
import { __redisTesting } from '../lib/redis';

const app = express().use(express.json()).use('/api/auth/2fa', auth2faRoutes).use(errorHandler);

/** L'anti-rejeu du code TOTP est désormais partagé : la route parle à Redis. */
const redis = createFakeRedis();

const secret = generateTotpSecret();
const backup = generateBackupCodes();
const tmpToken = signTwoFaToken(7);

/**
 * ⚠ Le frein par compte de `/verify` (A5-02) plafonne à dix essais par quart d'heure, et son
 * compteur de test est de process : tous les appels de ce fichier portant le MÊME `tmpToken`
 * partagent ce budget. Un scénario supplémentaire prend son propre jeton (`signTwoFaToken`
 * sur un autre identifiant) plutôt que d'épuiser celui-ci.
 */
const verify = (code: string, token = tmpToken) =>
  request(app).post('/api/auth/2fa/verify').send({ tmpToken: token, code });

beforeEach(() => {
  vi.clearAllMocks();
  __testing.usedTotp.clear();
  redis.flush();
  redis.failing = false;
  __redisTesting.setClient(redis);
  db.user.findUnique.mockResolvedValue({
    id: 7,
    email: 'a@b.c',
    role: 'ARTIST',
    totpSecret: secret,
    totpEnabledAt: new Date(),
    backupCodes: [...backup.hashes],
  });
  db.user.updateMany.mockResolvedValue({ count: 1 });
});

afterAll(() => {
  __redisTesting.reset();
});

/**
 * Un code TOTP reste valide pendant tout son pas de temps. Sans mémoire des codes déjà
 * présentés, celui qu'on intercepte se rejoue tant que la fenêtre n'est pas passée : le
 * second facteur ne prouve alors plus la possession du téléphone.
 */
describe('POST /api/auth/2fa/verify — anti-rejeu du code TOTP', () => {
  it('accepte le code une première fois', async () => {
    const res = await verify(await currentTotp(secret));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('refuse le même code rejoué, comme un code faux', async () => {
    const code = await currentTotp(secret);
    expect((await verify(code)).status).toBe(200);
    const replay = await verify(code);
    expect(replay.status).toBe(401);
    expect((replay.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('refuse un code faux', async () => {
    expect((await verify('000000')).status).toBe(401);
  });
});

/**
 * A3-09 — la route consommait le code dans une `Map` de process. Deux répliques derrière le
 * même frontal ne partageaient donc rien : le code intercepté repassait en tombant sur la
 * seconde, et un simple redémarrage suffisait à le rendre rejouable. Ces deux scénarios
 * échouent tant que la route appelle la garde locale au lieu de la garde partagée.
 */
describe('POST /api/auth/2fa/verify — anti-rejeu partagé entre répliques (A3-09)', () => {
  it('refuse le code déjà consommé sur une AUTRE réplique', async () => {
    const token = signTwoFaToken(101);
    const code = await currentTotp(secret);
    expect((await verify(code, token)).status).toBe(200);
    // Ce que voit la seconde réplique : sa mémoire de process est vierge, seul le marqueur
    // partagé témoigne de la première tentative.
    __testing.usedTotp.clear();
    const replay = await verify(code, token);
    expect(replay.status).toBe(401);
    expect((replay.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('refuse le code quand le marqueur partagé est injoignable (échec fermé)', async () => {
    // Le refus est le comportement voulu : sans marqueur, la route ne peut pas affirmer que
    // le code n'a pas déjà servi ailleurs. Elle ne perd rien en disponibilité, les deux
    // limiteurs qui la précèdent étant eux aussi adossés à Redis.
    redis.failing = true;
    expect((await verify(await currentTotp(secret), signTwoFaToken(102))).status).toBe(401);
  });
});

describe('POST /api/auth/2fa/verify — codes de secours', () => {
  it('accepte un code de secours et le retire de la liste', async () => {
    const res = await verify(backup.plain[2]!);
    expect(res.status).toBe(200);
    const call = db.user.updateMany.mock.calls[0]![0] as {
      where: { backupCodes: { has: string } };
      data: { backupCodes: string[] };
    };
    expect(call.data.backupCodes).toHaveLength(9);
    expect(call.data.backupCodes).not.toContain(backup.hashes[2]);
    // La suppression est conditionnée au code encore présent : c'est ce qui sérialise
    // deux requêtes concurrentes portant le même code sur la ligne PostgreSQL.
    expect(call.where.backupCodes.has).toBe(backup.hashes[2]);
  });

  it('accepte un code de secours recopié avec sa casse et ses séparateurs libres', async () => {
    const res = await verify(backup.plain[4]!.replace(/-/g, '').toUpperCase());
    expect(res.status).toBe(200);
  });

  // La course : deux requêtes portent le même code, PostgreSQL n'en laisse consommer qu'une.
  it('refuse quand la ligne ne porte déjà plus le code', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await verify(backup.plain[5]!);
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('refuse un code de secours inconnu sans toucher à la liste', async () => {
    const res = await verify('deadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.status).toBe(401);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  // 128 bits en hexadécimal groupés par 8 : 35 caractères. Le plafond de validation doit
  // les laisser passer, sinon le code de secours est refusé le jour où le téléphone manque.
  it('laisse passer la longueur d’un code de secours à 128 bits', async () => {
    expect(backup.plain[0]).toHaveLength(35);
    const res = await verify(backup.plain[0]!);
    expect(res.status).toBe(200);
  });
});

/**
 * A1-01 — quatrième porte : le compte peut être désactivé entre le mot de passe et le code.
 * Le second facteur n'est pas une entrée de plus, c'est la même entrée : sans cette garde,
 * la 2FA rendait au partant le jeton que `/login` venait de lui refuser.
 */
describe('POST /api/auth/2fa/verify — compte désactivé', () => {
  it('refuse un compte désactivé, code TOTP valide compris', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'a@b.c',
      role: 'ARTIST',
      totpSecret: secret,
      totpEnabledAt: new Date(),
      backupCodes: [...backup.hashes],
      disabledAt: new Date(),
    });
    const res = await verify(await currentTotp(secret), signTwoFaToken(8));
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
  });
});

/**
 * A5-02 — le limiteur de `/verify` était de quinze coups par IP, sans aucun lien avec le
 * compte visé par le `tmpToken`. Deux défauts d'un coup : le seizième arrivant du matin,
 * derrière la sortie NAT du studio, ne pouvait plus valider son code ; et des essais venus
 * de plusieurs machines n'étaient bornés sur aucun compte.
 */
describe('POST /api/auth/2fa/verify — frein par compte (A5-02)', () => {
  it('borne les essais visant un compte donné, puis refuse en 429', async () => {
    const token = signTwoFaToken(99);
    for (let i = 0; i < 10; i += 1) {
      expect((await verify('000000', token)).status).toBe(401);
    }
    expect((await verify('000000', token)).status).toBe(429);
    // Un autre compte garde son budget : la clé est le compte, pas la source.
    expect((await verify('000000', signTwoFaToken(100))).status).toBe(401);
  });
});
