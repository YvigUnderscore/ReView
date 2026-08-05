// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from './rateLimit';

const call = (mw: ReturnType<typeof rateLimit>, req: Partial<Request>) => {
  const res = {
    statusCode: 0,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json() {
      return this;
    },
  };
  const next = vi.fn() as unknown as NextFunction;
  mw(req as Request, res as unknown as Response, next);
  return { res, passed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0 };
};

describe('rateLimit', () => {
  it('laisse passer jusqu’à la limite puis répond 429', () => {
    const mw = rateLimit({ max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) expect(call(mw, { ip: '1.2.3.4' }).passed).toBe(true);
    const blocked = call(mw, { ip: '1.2.3.4' });
    expect(blocked.passed).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
  });

  it('compte séparément deux clients', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000 });
    expect(call(mw, { ip: '1.1.1.1' }).passed).toBe(true);
    expect(call(mw, { ip: '2.2.2.2' }).passed).toBe(true);
    expect(call(mw, { ip: '1.1.1.1' }).passed).toBe(false);
  });

  // Certains limiteurs (déverrouillage d'un partage) s'exécutent AVANT la validation Zod :
  // la clé incorpore alors une valeur de requête arbitraire et de longueur libre.
  it('borne la longueur de la clé', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, keyGenerator: (r) => String(r.params?.token) });
    const long = 'a'.repeat(50_000);
    expect(call(mw, { params: { token: long } } as Partial<Request>).passed).toBe(true);
    // Même préfixe → même compteur : la clé a bien été tronquée, pas laissée entière.
    expect(call(mw, { params: { token: long + 'DIFFERENT' } } as Partial<Request>).passed).toBe(false);
  });

  it('ne laisse pas la table de comptage croître sans fin', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, keyGenerator: (r) => String(r.params?.token) });
    // Bien au-delà du plafond : le middleware doit rester sain (et borné) sans jamais lever.
    for (let i = 0; i < 120_000; i++) call(mw, { params: { token: `t${i}` } } as Partial<Request>);
    expect(call(mw, { params: { token: 'apres-purge' } } as Partial<Request>).passed).toBe(true);
  });
});
