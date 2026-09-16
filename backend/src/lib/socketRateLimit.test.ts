// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { logger } from './logger';
import {
  admitPacket,
  attachSocketRateLimit,
  createBudget,
  estimatePayloadBytes,
  packetCost,
  resolveOptions,
  DEFAULT_CAPACITY,
  DEFAULT_MAX_PAYLOAD_BYTES,
  type RateLimitedSocket,
  type SocketBudget,
} from './socketRateLimit';

/**
 * Deux propriétés à tenir en même temps, et elles tirent en sens contraire :
 *
 * - le trafic légitime passe **toujours** (une salle de dailies émet `live:sync` à 30 Hz,
 *   et le front émet `activity` à chaque frappe) ;
 * - le scénario de l'audit — `join_review` en boucle sur des identifiants inexistants,
 *   deux requêtes Postgres par refus — est arrêté AVANT le gestionnaire.
 */

const options = resolveOptions();

/** Émet `count` fois l'événement à `t` et rend le décompte des verdicts. */
function burst(budget: SocketBudget, event: string, count: number, at: number, bytes = 16) {
  const seen = { allow: 0, drop: 0, disconnect: 0 };
  for (let i = 0; i < count; i += 1) seen[admitPacket(budget, event, bytes, options, at)] += 1;
  return seen;
}

beforeEach(() => vi.clearAllMocks());

describe('socketRateLimit — le trafic légitime passe', () => {
  it('laisse passer une minute de salle live à 30 Hz avec les frappes du clavier', () => {
    const budget = createBudget(0);
    let dropped = 0;
    // 60 s à 30 trames/s, plus un `activity` toutes les 200 ms (frappe soutenue).
    for (let tick = 0; tick < 1800; tick += 1) {
      const now = tick * 33;
      if (admitPacket(budget, 'live:sync', 120, options, now) !== 'allow') dropped += 1;
      if (tick % 6 === 0 && admitPacket(budget, 'activity', 8, options, now) !== 'allow') dropped += 1;
    }
    expect(dropped).toBe(0);
  });

  it("absorbe la rafale d'ouverture d'un écran (plusieurs joins d'un coup)", () => {
    const budget = createBudget(0);
    expect(burst(budget, 'join_review', 12, 0)).toMatchObject({ allow: 12, drop: 0 });
  });
});

describe('socketRateLimit — le scénario de l’audit est arrêté', () => {
  it('borne une boucle de `join_review` à une poignée de passages par rafale', () => {
    const budget = createBudget(0);
    const seen = burst(budget, 'join_review', 500, 0);
    // 240 jetons / 12 par join = 20 passages, puis plus rien tant que le seau ne recharge pas.
    expect(seen.allow).toBe(20);
    expect(seen.drop + seen.disconnect).toBe(480);
  });

  /**
   * Le calibrage a doublé la recharge (le régime légitime du pilote la frôlait), mais la
   * borne qui compte est celle des requêtes Postgres : elle ne doit PAS avoir bougé. Dix
   * `join_review` par seconde en régime permanent, soit vingt requêtes — c'est le contrat.
   */
  it('tient dix `join_review` par seconde en régime permanent, pas davantage', () => {
    const budget = createBudget(0);
    burst(budget, 'join_review', 100, 0); // vide le seau
    let allowed = 0;
    // Dix secondes de martèlement, vingt tentatives par tranche de 100 ms.
    for (let ms = 100; ms <= 10_000; ms += 100) allowed += burst(budget, 'join_review', 20, ms).allow;
    expect(allowed).toBe(100);
  });

  it('ferme la connexion sur un dépassement soutenu', () => {
    const budget = createBudget(0);
    const seen = burst(budget, 'join_review', 500, 0);
    expect(seen.disconnect).toBeGreaterThan(0);
  });

  it('ne compte pas comme abus une rafale suivie d’un retour au calme', () => {
    const budget = createBudget(0);
    burst(budget, 'join_review', 100, 0);
    expect(budget.drops).toBeGreaterThan(0);
    // Deux secondes de silence : le seau se remplit, le compteur d'abus retombe.
    admitPacket(budget, 'activity', 8, options, 2000);
    expect(budget.drops).toBe(0);
  });

  it('recharge exactement au régime annoncé', () => {
    const budget = createBudget(0);
    burst(budget, 'live:sync', 300, 0); // vide le seau
    expect(admitPacket(budget, 'live:sync', 8, options, 0)).not.toBe('allow');
    // 100 ms plus tard : 12 jetons rechargés, douze trames passent, la treizième non.
    expect(burst(budget, 'live:sync', 20, 100)).toMatchObject({ allow: 12 });
  });
});

describe('socketRateLimit — amplification par la taille', () => {
  it('refuse une trame démesurée sans jamais la relayer', () => {
    const budget = createBudget(0);
    const verdict = admitPacket(budget, 'live:sync', DEFAULT_MAX_PAYLOAD_BYTES + 1, options, 0);
    expect(verdict).not.toBe('allow');
    expect(budget.tokens).toBe(DEFAULT_CAPACITY);
  });

  it('facture la charge utile en plus du coût de l’événement', () => {
    expect(packetCost('live:sync', 0, options)).toBe(1);
    // Un `LiveSyncPayload` réel (playhead, pause, caméra, wipe) pèse quelques centaines
    // d'octets : il ne doit RIEN payer de plus, sinon le pilote se ferait étrangler.
    expect(packetCost('live:sync', 900, options)).toBe(1);
    expect(packetCost('live:sync', DEFAULT_MAX_PAYLOAD_BYTES, options)).toBe(5);
    expect(packetCost('inconnu', 0, options)).toBe(options.defaultCost);
  });

  /**
   * Doubler la recharge ne doit pas doubler l'amplification : ce qui entre ici ressort
   * multiplié par le nombre de participants de la salle. Le plafond de charge utile et la
   * tranche facturée ont été resserrés d'autant — le débit d'octets relayables par une
   * connexion reste sous celui qu'autorisaient les réglages d'origine (32 Kio à 6,6 trames/s,
   * soit ~213 Kio/s).
   */
  it('ne relaie pas plus d’octets qu’avant le relèvement de la recharge', () => {
    const budget = createBudget(0);
    const bytes = DEFAULT_MAX_PAYLOAD_BYTES;
    // Réserve vidée : on mesure le régime PERMANENT, pas la rafale d'ouverture.
    burst(budget, 'live:sync', 100, 0, bytes);
    let relayed = 0;
    // Une seconde de martèlement à la taille maximale acceptée, par tranches de 10 ms.
    for (let ms = 10; ms <= 1000; ms += 10)
      relayed += burst(budget, 'live:sync', 50, ms, bytes).allow * bytes;
    // Réglages d'origine : 32 Kio à 60/9 trames par seconde, soit ~211 Kio/s.
    expect(relayed).toBeLessThan((60 / 9) * 32 * 1024);
  });

  it('mesure les formes usuelles, et compte une structure circulaire comme démesurée', () => {
    expect(estimatePayloadBytes(['abc'])).toBe(3);
    expect(estimatePayloadBytes([42, true, null])).toBe(24);
    expect(estimatePayloadBytes([{ playhead: 12.5 }])).toBe(17);
    expect(estimatePayloadBytes([new Uint8Array(1000)])).toBe(1000);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimatePayloadBytes([circular])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('attachSocketRateLimit — branchement sur une connexion', () => {
  function fakeSocket() {
    let middleware: ((packet: unknown[], next: (err?: Error) => void) => void) | null = null;
    const disconnect = vi.fn();
    const socket: RateLimitedSocket = {
      id: 'sock-1',
      use: (fn) => {
        middleware = fn;
        return socket;
      },
      disconnect,
    };
    return {
      socket,
      disconnect,
      emit(event: string, ...args: unknown[]) {
        const next = vi.fn();
        middleware!([event, ...args], next);
        return next;
      },
    };
  }

  it("n'appelle pas le gestionnaire d'un paquet rejeté", () => {
    const clock = { t: 0 };
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => clock.t });
    // Vingt joins passent, le vingt-et-unième n'atteint jamais le gestionnaire —
    // c'est-à-dire aucune requête Postgres.
    for (let i = 0; i < 20; i += 1) expect(fake.emit('join_review', i)).toHaveBeenCalledOnce();
    expect(fake.emit('join_review', 21)).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
  });

  it('ferme la connexion et le journalise sur un abus soutenu', () => {
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => 0 });
    for (let i = 0; i < 500; i += 1) fake.emit('join_review', i);
    expect(fake.disconnect).toHaveBeenCalledWith(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ socketId: 'sock-1', event: 'join_review' }),
      expect.any(String),
    );
  });

  it('refuse une trame démesurée sans fermer une connexion par ailleurs honnête', () => {
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => 0 });
    expect(
      fake.emit('live:sync', 'k', { blob: 'x'.repeat(DEFAULT_MAX_PAYLOAD_BYTES) }),
    ).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
    expect(fake.emit('live:sync', 'k', { playhead: 1 })).toHaveBeenCalledOnce();
  });
});
