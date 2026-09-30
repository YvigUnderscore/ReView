// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';

/**
 * Limitation de débit de la surface **Socket.io**.
 *
 * Le seul limiteur global du produit est monté sur `/api` (`app.ts`). Le trafic websocket
 * ne le traverse jamais : le nginx frontal le route par une `location /socket.io/` distincte,
 * et côté serveur `io.use(...)` n'exécute qu'une authentification. Une connexion authentifiée
 * — y compris celle d'un CLIENT, le rôle le plus faible du produit — pouvait donc émettre des
 * événements sans aucun compteur. Or les gestionnaires interrogent la base AVANT de refuser :
 * `join_review` coûte deux requêtes Postgres par identifiant refusé. Quelques milliers
 * d'émissions par seconde sur UNE websocket saturent le pool Prisma, et toute l'instance
 * ralentit. Variante d'amplification : une trame `live:sync` volumineuse recopiée à chaque
 * participant d'une salle de dailies.
 *
 * Le remède est un **seau à jetons par connexion** :
 *
 * - chaque événement coûte des jetons, **plus cher quand il touche la base** (`join_review`,
 *   `live:join`) que quand il ne fait que relayer (`live:sync`, `activity`) ;
 * - la taille de la charge utile est facturée en plus, et une trame franchement démesurée
 *   est refusée d'emblée : c'est le plafond d'amplification ;
 * - au-delà du budget, le paquet est **ignoré en silence** — le gestionnaire n'est pas
 *   appelé, donc aucune requête base n'est émise. Pas d'erreur renvoyée : un client
 *   légitime n'a pas à voir d'exception, et un client abusif n'a pas à recevoir de
 *   signal de retour ;
 * - un dépassement *soutenu* (le compteur de rejets n'est remis à zéro que lorsque le seau
 *   est revenu plein, c'est-à-dire quand la connexion s'est tue) ferme la connexion.
 *
 * Le module est **découplé de `SocketService`** : il ne connaît qu'une forme minimale de
 * socket (`use` / `disconnect`), ce qui le rend testable sans serveur et évite d'enfermer
 * une frontière de sécurité dans une closure inaccessible.
 *
 * ## Calibrage (relevé sur le client, pas estimé)
 *
 * Le seau est **par connexion**, et une salle de dailies à trente participants ce sont
 * trente connexions, donc trente seaux : le nombre de spectateurs ne multiplie pas le débit
 * d'UN client. Le plafond légitime est celui du **pilote**, le seul à émettre en continu :
 *
 * | Source (front)                                    | Cadence |
 * |---------------------------------------------------|---------|
 * | `useLiveSession` — diffusion périodique `live:sync` | ≤ 30 Hz (`syncHz` borné à 30) |
 * | `usePointerBroadcast` — curseur, sur `live:sync`   | ~20 Hz (`POINTER_INTERVAL_MS = 50`) |
 * | `usePresence` — `activity` à chaque frappe/clic    | ~10 Hz en frappe soutenue |
 *
 * Soit **≈ 60 événements par seconde pour un pilote parfaitement honnête**. Le premier
 * réglage (60 jetons/s) était donc calé *pile* sur ce plafond : la moindre gigue de
 * `setInterval`, un `join_review` de navigation ou un co-pilote qui prend la main pendant
 * un drag suffisait à faire tomber des trames — et 200 rejets sans retour au calme
 * FERMENT la connexion. Un limiteur qui déconnecte le pilote d'une projection client est
 * pire que pas de limiteur : il serait désarmé à la première plainte.
 *
 * D'où 120 jetons/s, qui laissent un facteur deux au régime relevé. Pour que ce doublement
 * ne relâche pas la borne qui compte — celle des requêtes Postgres — **les coûts des
 * événements qui touchent la base sont doublés en même temps** : à 12 jetons, `join_review`
 * reste limité à dix tentatives par seconde, soit vingt requêtes, exactement comme avant.
 * Et pour que le doublement ne double pas non plus l'amplification (une trame relayée à
 * trente participants), le plafond de charge utile passe de 32 Kio à 8 Kio et la tranche
 * facturée de 4 Kio à 2 Kio : la plus grosse trame acceptable coûte désormais 5 jetons au
 * lieu de 9, soit ~24 trames/s au lieu de 6,6 — mais de 8 Kio au lieu de 32, donc **moins**
 * d'octets relayés qu'avec les réglages d'origine. Aucune trame légitime n'approche 2 Kio
 * (un `LiveSyncPayload` = playhead, pause, caméra, wipe : quelques centaines d'octets).
 */

/** Jetons du seau plein : deux secondes de réserve, pour absorber l'ouverture d'un écran. */
export const DEFAULT_CAPACITY = 240;

/** Recharge, en jetons par seconde : le régime permanent toléré (2× le pilote relevé). */
export const DEFAULT_REFILL_PER_SECOND = 120;

/**
 * Coût d'un événement non listé. Volontairement au-dessus des événements de relais : un
 * nom d'événement inconnu du serveur n'a aucun gestionnaire, mais il traverse quand même
 * le parseur et le journal — et c'est la porte la moins surveillée.
 */
export const DEFAULT_COST = 4;

/**
 * Coût par événement. Les points d'entrée qui **résolvent un projet en base avant de
 * refuser** sont les plus chers : `join_review` coûte deux requêtes Postgres par identifiant
 * refusé, `join_project` une revalidation plus un contrôle RBAC. À 12 jetons, une connexion
 * plafonne à dix tentatives par seconde en régime permanent — sans commune mesure avec les
 * 32 000 événements par seconde mesurés en l'absence de compteur.
 *
 * `join_project` / `leave_project` sont listés parce qu'ils sont ouverts à TOUS les sockets,
 * invité de partage compris (ils vivent hors du bloc `if (socket.user)`) : les laisser au
 * coût par défaut aurait laissé la surface la plus exposée trois fois moins chère que la
 * même opération sur une review.
 */
export const DEFAULT_COSTS: Readonly<Record<string, number>> = {
  join_review: 12,
  'live:join': 12,
  join_project: 12,
  leave_review: 1,
  'live:leave': 1,
  leave_project: 1,
  'live:sync': 1,
  'live:handoff': 6,
  'live:cohost': 6,
  activity: 1,
};

/**
 * Au-delà, la trame est refusée sans être relayée. Aucune trame légitime n'en approche :
 * `live:sync` transporte un playhead, un état de pause, une caméra — quelques centaines
 * d'octets. C'est le plafond d'amplification : ce qui entre ici ressort multiplié par le
 * nombre de participants de la salle.
 */
export const DEFAULT_MAX_PAYLOAD_BYTES = 8 * 1024;

/**
 * Tranche de charge utile facturée un jeton supplémentaire. Assez large pour qu'une trame
 * légitime ne paie rien, assez fine pour que le coût suive la taille sur les trames lourdes.
 */
const PAYLOAD_TOKEN_BYTES = 2048;

/** Rejets consécutifs (sans retour au calme) avant fermeture de la connexion. */
export const DEFAULT_DROPS_BEFORE_DISCONNECT = 200;

export interface SocketRateLimitOptions {
  capacity?: number;
  refillPerSecond?: number;
  costs?: Readonly<Record<string, number>>;
  defaultCost?: number;
  maxPayloadBytes?: number;
  dropsBeforeDisconnect?: number;
  /** Horloge injectable : les tests pilotent le temps plutôt que de l'attendre. */
  now?: () => number;
}

interface ResolvedOptions {
  capacity: number;
  refillPerSecond: number;
  costs: Readonly<Record<string, number>>;
  defaultCost: number;
  maxPayloadBytes: number;
  dropsBeforeDisconnect: number;
}

/** État du seau d'une connexion. Volontairement nu : une connexion, un objet, rien de global. */
export interface SocketBudget {
  tokens: number;
  lastRefillAt: number;
  /** Rejets depuis le dernier retour au calme — sert à distinguer la rafale de l'abus. */
  drops: number;
}

export type PacketVerdict = 'allow' | 'drop' | 'disconnect';

export function resolveOptions(options: SocketRateLimitOptions = {}): ResolvedOptions {
  return {
    capacity: options.capacity ?? DEFAULT_CAPACITY,
    refillPerSecond: options.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND,
    costs: options.costs ?? DEFAULT_COSTS,
    defaultCost: options.defaultCost ?? DEFAULT_COST,
    maxPayloadBytes: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    dropsBeforeDisconnect: options.dropsBeforeDisconnect ?? DEFAULT_DROPS_BEFORE_DISCONNECT,
  };
}

/** Seau plein à la connexion : la première rafale d'un écran qui s'ouvre est légitime. */
export function createBudget(now: number, options: SocketRateLimitOptions = {}): SocketBudget {
  return { tokens: resolveOptions(options).capacity, lastRefillAt: now, drops: 0 };
}

/**
 * Poids d'une charge utile, en octets. Les formes simples sont mesurées sans sérialiser ;
 * une structure circulaire (ou autrement insérialisable) est comptée comme démesurée —
 * elle ne peut de toute façon pas venir d'un client Socket.io honnête.
 */
export function estimatePayloadBytes(args: readonly unknown[]): number {
  let total = 0;
  for (const arg of args) {
    if (arg === null || arg === undefined || typeof arg === 'number' || typeof arg === 'boolean') {
      total += 8;
      continue;
    }
    if (typeof arg === 'string') {
      total += Buffer.byteLength(arg, 'utf-8');
      continue;
    }
    if (arg instanceof ArrayBuffer) {
      total += arg.byteLength;
      continue;
    }
    if (ArrayBuffer.isView(arg)) {
      total += arg.byteLength;
      continue;
    }
    try {
      total += Buffer.byteLength(JSON.stringify(arg) ?? '', 'utf-8');
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return total;
}

/** Coût total d'un paquet : celui de l'événement, plus la taille de sa charge utile. */
export function packetCost(event: string, payloadBytes: number, options: ResolvedOptions): number {
  const base = options.costs[event] ?? options.defaultCost;
  if (!Number.isFinite(payloadBytes)) return Number.POSITIVE_INFINITY;
  return base + Math.floor(payloadBytes / PAYLOAD_TOKEN_BYTES);
}

/**
 * Verdict pour un paquet, et mise à jour du seau. `now` est fourni par l'appelant pour que
 * la fonction reste pure vis-à-vis de l'horloge.
 */
export function admitPacket(
  budget: SocketBudget,
  event: string,
  payloadBytes: number,
  options: ResolvedOptions,
  now: number,
): PacketVerdict {
  // Recharge proportionnelle au temps écoulé. Une horloge qui recule (ajustement NTP) ne
  // doit ni créditer ni débiter : on repart simplement de l'instant présent.
  const elapsedMs = Math.max(0, now - budget.lastRefillAt);
  budget.lastRefillAt = now;
  budget.tokens = Math.min(options.capacity, budget.tokens + (elapsedMs * options.refillPerSecond) / 1000);
  // Seau plein = la connexion s'est tue : la rafale précédente était une rafale, pas un abus.
  if (budget.tokens >= options.capacity) budget.drops = 0;

  if (payloadBytes > options.maxPayloadBytes) return countDrop(budget, options);

  const cost = packetCost(event, payloadBytes, options);
  if (cost > budget.tokens) return countDrop(budget, options);

  budget.tokens -= cost;
  return 'allow';
}

function countDrop(budget: SocketBudget, options: ResolvedOptions): PacketVerdict {
  budget.drops += 1;
  return budget.drops >= options.dropsBeforeDisconnect ? 'disconnect' : 'drop';
}

/** Forme minimale d'un socket, pour ne dépendre ni de `socket.io` ni de `SocketService`. */
export interface RateLimitedSocket {
  id?: string;
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): unknown;
  disconnect(close?: boolean): unknown;
}

/**
 * Branche le limiteur sur une connexion. À poser une fois par socket accepté, **avant**
 * l'enregistrement des gestionnaires d'événements — un middleware `socket.use` ne
 * s'applique qu'aux paquets entrants, il ne dépend pas de l'ordre d'enregistrement des
 * `socket.on`, mais poser la garde d'abord garde la lecture évidente.
 */
export function attachSocketRateLimit(
  socket: RateLimitedSocket,
  options: SocketRateLimitOptions = {},
): SocketBudget {
  const resolved = resolveOptions(options);
  const clock = options.now ?? Date.now;
  const budget = createBudget(clock(), options);

  socket.use((packet, next) => {
    const event = typeof packet[0] === 'string' ? packet[0] : '';
    const verdict = admitPacket(budget, event, estimatePayloadBytes(packet.slice(1)), resolved, clock());
    if (verdict === 'allow') {
      next();
      return;
    }
    if (verdict === 'disconnect') {
      logger.warn({ socketId: socket.id, event }, '[socket] débit abusif : connexion fermée');
      socket.disconnect(true);
    }
    // 'drop' : `next` n'est pas appelé, donc le gestionnaire n'est pas exécuté et aucune
    // requête base n'est émise. C'est tout l'intérêt de refuser AVANT le gestionnaire.
  });

  return budget;
}
