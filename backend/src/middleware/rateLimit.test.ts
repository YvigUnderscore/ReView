// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit, identityRateKey, identityMax, __rateLimitTesting } from './rateLimit';
import { signAccessToken, signRefreshToken, signTwoFaToken } from '../lib/jwt';
import { Role } from '@prisma/client';

/**
 * Le comptage lui-même vit dans Redis (script Lua de `rate-limit-redis`) : ces tests
 * substituent le compteur pour vérifier ce qui nous appartient — le choix de la clé, le
 * plafond, l'isolation entre limiteurs, et l'échec **fermé** quand le compteur est muet.
 */

/** Compteur en mémoire, une fenêtre unique : suffit pour éprouver la logique du middleware. */
function memoryCounters() {
  const hits = new Map<string, number>();
  const opened: { name: string; windowMs: number }[] = [];
  let broken = false;
  return {
    hits,
    opened,
    break: (): void => {
      broken = true;
    },
    factory: (name: string, windowMs: number) => {
      opened.push({ name, windowMs });
      return {
        hit: (key: string): Promise<number> => {
          if (broken) return Promise.reject(new Error('redis down'));
          const full = `${name}:${key}`;
          const total = (hits.get(full) ?? 0) + 1;
          hits.set(full, total);
          return Promise.resolve(total);
        },
      };
    },
  };
}

let counters: ReturnType<typeof memoryCounters>;

beforeEach(() => {
  counters = memoryCounters();
  __rateLimitTesting.setCounterFactory(counters.factory);
});

afterEach(() => {
  __rateLimitTesting.setCounterFactory(null);
});

/** Joue une requête à travers le middleware et rend ce qu'il en a fait. */
async function call(
  mw: ReturnType<typeof rateLimit>,
  req: Partial<Request>,
): Promise<{ passed: boolean; statusCode: number }> {
  let statusCode = 0;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => (settle = resolve));
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      settle();
      return this;
    },
  };
  const next = vi.fn(() => settle()) as unknown as NextFunction;
  mw({ headers: {}, ...req } as Request, res as unknown as Response, next);
  await done;
  return { passed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0, statusCode };
}

describe('rateLimit — plafond', () => {
  it('laisse passer jusqu’à la limite puis répond 429', async () => {
    const mw = rateLimit({ name: 't1', max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) expect((await call(mw, { ip: '1.2.3.4' })).passed).toBe(true);
    const blocked = await call(mw, { ip: '1.2.3.4' });
    expect(blocked.passed).toBe(false);
    expect(blocked.statusCode).toBe(429);
  });

  it('compte séparément deux clients', async () => {
    const mw = rateLimit({ name: 't2', max: 1, windowMs: 60_000 });
    expect((await call(mw, { ip: '1.1.1.1' })).passed).toBe(true);
    expect((await call(mw, { ip: '2.2.2.2' })).passed).toBe(true);
    expect((await call(mw, { ip: '1.1.1.1' })).passed).toBe(false);
  });

  it('accepte un plafond calculé par requête', async () => {
    const mw = rateLimit({
      name: 't3',
      windowMs: 60_000,
      max: (req) => (req.ip === 'vip' ? 3 : 1),
      keyGenerator: (req) => req.ip ?? 'x',
    });
    expect((await call(mw, { ip: 'vip' })).passed).toBe(true);
    expect((await call(mw, { ip: 'vip' })).passed).toBe(true);
    expect((await call(mw, { ip: 'autre' })).passed).toBe(true);
    expect((await call(mw, { ip: 'autre' })).passed).toBe(false);
  });

  // Certains limiteurs (déverrouillage d'un partage) s'exécutent AVANT la validation Zod :
  // la clé incorpore alors une valeur de requête arbitraire et de longueur libre.
  it('borne la longueur de la clé', async () => {
    const mw = rateLimit({
      name: 't4',
      max: 1,
      windowMs: 60_000,
      keyGenerator: (r) => String(r.params?.token),
    });
    const long = 'a'.repeat(50_000);
    expect((await call(mw, { params: { token: long } } as Partial<Request>)).passed).toBe(true);
    // Même préfixe → même compteur : la clé a bien été tronquée, pas laissée entière.
    expect((await call(mw, { params: { token: long + 'DIFFERENT' } } as Partial<Request>)).passed).toBe(
      false,
    );
  });

  // Le compteur d'un client ne doit jamais être rendu par l'activité d'un autre : la clé de
  // ce limiteur incorpore une donnée de requête, un même client peut donc en forger autant
  // qu'il veut. Chaque clé est indépendante dans Redis et s'efface à l'échéance de SA fenêtre.
  it('ne rend pas ses tentatives à un client qui forge des milliers de clés', async () => {
    const mw = rateLimit({
      name: 't5',
      max: 1,
      windowMs: 60_000,
      keyGenerator: (r) => String(r.params?.token),
    });
    const victim = { params: { token: 'cible' } } as Partial<Request>;
    expect((await call(mw, victim)).passed).toBe(true);
    expect((await call(mw, victim)).passed).toBe(false);
    for (let i = 0; i < 2_000; i++) await call(mw, { params: { token: `t${i}` } } as Partial<Request>);
    expect((await call(mw, victim)).passed).toBe(false);
  });
});

describe('rateLimit — isolation et panne', () => {
  it('deux limiteurs distincts ne partagent pas leur compteur', async () => {
    const global = rateLimit({ name: 'global', max: 2, windowMs: 60_000 });
    const share = rateLimit({ name: 'share', max: 1, windowMs: 60_000 });
    expect((await call(share, { ip: '9.9.9.9' })).passed).toBe(true);
    expect((await call(share, { ip: '9.9.9.9' })).passed).toBe(false);
    // Le limiteur global n'a rien consommé pour cette IP.
    expect((await call(global, { ip: '9.9.9.9' })).passed).toBe(true);
  });

  it('sans nom explicite, l’empreinte sépare des limiteurs aux options différentes', () => {
    const a = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 10 });
    const b = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 5000 });
    const c = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 10 });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });

  it('échec fermé : compteur muet ⇒ 429, jamais un passage silencieux', async () => {
    const mw = rateLimit({ name: 't6', max: 100, windowMs: 60_000 });
    expect((await call(mw, { ip: '1.2.3.4' })).passed).toBe(true);
    counters.break();
    const blocked = await call(mw, { ip: '1.2.3.4' });
    expect(blocked.passed).toBe(false);
    expect(blocked.statusCode).toBe(429);
  });

  // Sous NODE_ENV=test le stockage est un compteur de process : la suite ne doit ni exiger
  // un Redis vivant, ni hériter des compteurs de l'exécution précédente.
  it('le compteur par défaut compte, puis rouvre sa fenêtre à l’échéance', async () => {
    __rateLimitTesting.setCounterFactory(null);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const mw = rateLimit({ name: 'defaut', max: 1, windowMs: 1_000 });
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(true);
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(false);
      vi.setSystemTime(new Date(Date.now() + 1_001));
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ouvre un compteur par limiteur, avec son nom et sa fenêtre', async () => {
    await call(rateLimit({ name: 'alpha', windowMs: 1_000 }), { ip: 'a' });
    await call(rateLimit({ name: 'beta', windowMs: 2_000 }), { ip: 'a' });
    expect(counters.opened).toEqual([
      { name: 'alpha', windowMs: 1_000 },
      { name: 'beta', windowMs: 2_000 },
    ]);
  });
});

describe('identityRateKey', () => {
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` }, ip: '5.5.5.5' });

  it('indexe sur le compte quand le jeton d’accès est valide', () => {
    const token = signAccessToken({ id: 42, email: 'a@b.c', role: Role.ARTIST });
    expect(identityRateKey(bearer(token) as unknown as Request)).toBe('u:42');
  });

  it('retombe sur l’IP sans jeton, ou avec un jeton illisible', () => {
    expect(identityRateKey({ headers: {}, ip: '5.5.5.5' } as unknown as Request)).toBe('ip:5.5.5.5');
    expect(identityRateKey(bearer('nimportequoi') as unknown as Request)).toBe('ip:5.5.5.5');
  });

  // Un jeton de rafraîchissement ou de 2FA n'authentifie pas une requête : lui accorder un
  // compteur propre offrirait une deuxième réserve de quota à qui possède déjà un compte.
  it('n’accepte que le jeton d’accès, pas les autres types signés du même secret', () => {
    const refresh = signRefreshToken({ id: 7, email: 'a@b.c', role: Role.ARTIST });
    const twofa = signTwoFaToken(7);
    expect(identityRateKey(bearer(refresh) as unknown as Request)).toBe('ip:5.5.5.5');
    expect(identityRateKey(bearer(twofa) as unknown as Request)).toBe('ip:5.5.5.5');
  });

  it('mémoïse la clé sur la requête : une seule vérification de signature', () => {
    const token = signAccessToken({ id: 8, email: 'a@b.c', role: Role.ARTIST });
    const req = bearer(token) as unknown as Request;
    expect(identityRateKey(req)).toBe('u:8');
    // La signature est effacée : sans mémoïsation, la clé retomberait sur l'IP.
    (req.headers as Record<string, string>)['authorization'] = 'Bearer casse';
    expect(identityRateKey(req)).toBe('u:8');
  });

  it('identityMax distingue le plafond du compte de celui de la sortie NAT', () => {
    const max = identityMax(6_000, 5_000);
    const token = signAccessToken({ id: 3, email: 'a@b.c', role: Role.ARTIST });
    expect(max(bearer(token) as unknown as Request)).toBe(6_000);
    expect(max({ headers: {}, ip: '5.5.5.5' } as unknown as Request)).toBe(5_000);
  });

  it('deux comptes derrière la même IP ne partagent plus de compteur', async () => {
    const mw = rateLimit({ name: 'nat', max: 1, windowMs: 60_000, keyGenerator: identityRateKey });
    const un = signAccessToken({ id: 1, email: 'a@b.c', role: Role.ARTIST });
    const deux = signAccessToken({ id: 2, email: 'd@b.c', role: Role.ARTIST });
    expect((await call(mw, bearer(un))).passed).toBe(true);
    expect((await call(mw, bearer(deux))).passed).toBe(true);
    expect((await call(mw, bearer(un))).passed).toBe(false);
  });
});
