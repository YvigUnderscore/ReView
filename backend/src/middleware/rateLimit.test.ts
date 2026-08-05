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

  // Le remplissage de la table ne doit JAMAIS effacer un compteur déjà établi : la clé de
  // ce limiteur incorpore une donnée de requête, un même client peut donc forger autant de
  // clés qu'il veut. Vider la table lui rendrait ses tentatives — le garde-fou mémoire
  // deviendrait une remise à zéro du limiteur, donc un moyen de forcer un mot de passe.
  it('ne rend pas ses tentatives à un client qui sature la table', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, keyGenerator: (r) => String(r.params?.token) });
    const victim = { params: { token: 'cible' } } as Partial<Request>;

    expect(call(mw, victim).passed).toBe(true); // 1re tentative : consommée
    expect(call(mw, victim).passed).toBe(false); // 2e : bloquée

    // Saturation délibérée de la table avec des clés jetables.
    for (let i = 0; i < 100_001; i++) call(mw, { params: { token: `t${i}` } } as Partial<Request>);

    // La clé de la cible doit rester bloquée.
    expect(call(mw, victim).passed).toBe(false);
  });

  it('reste borné en mémoire, en refusant les clés nouvelles plutôt qu’en vidant la table', () => {
    const mw = rateLimit({ max: 5, windowMs: 60_000, keyGenerator: (r) => String(r.params?.token) });
    for (let i = 0; i < 100_001; i++) call(mw, { params: { token: `t${i}` } } as Partial<Request>);
    // Échec fermé : au plafond, une clé inconnue est refusée (429), pas accueillie.
    const overflow = call(mw, { params: { token: 'nouvelle' } } as Partial<Request>);
    expect(overflow.passed).toBe(false);
    expect(overflow.res.statusCode).toBe(429);
  });
});
