// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const app = express().use(express.json()).use('/api/auth/2fa', auth2faRoutes).use(errorHandler);

const secret = generateTotpSecret();
const backup = generateBackupCodes();
const tmpToken = signTwoFaToken(7);

const verify = (code: string) => request(app).post('/api/auth/2fa/verify').send({ tmpToken, code });

beforeEach(() => {
  vi.clearAllMocks();
  __testing.usedTotp.clear();
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
