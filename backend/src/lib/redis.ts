// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Redis, { type RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from './logger';
import { registerShutdownTask, SHUTDOWN_PHASE } from './gracefulShutdown';

/**
 * Accès Redis partagé du process API.
 *
 * Deux usages cohabitent ici :
 *
 *  1. `redisConnectionOptions` — **options** (et non instance) pour BullMQ, qui instancie
 *     son propre client avec sa version bundlée d'ioredis ; fournir une instance ferait
 *     entrer en conflit deux copies d'ioredis (dual-package hazard).
 *     `maxRetriesPerRequest: null` est requis par les workers BullMQ.
 *
 *  2. Le **support de l'état volatil** (limiteur de débit, présence, salles live, cache
 *     d'identité) : un client de commandes, un client abonné multiplexé, un battement
 *     de cœur partagé. Tout cet état vivait en mémoire de process — deux répliques
 *     doublaient les quotas, et un redémarrage effaçait les salles live.
 *
 * Le transport pub/sub est **explicitement armé** (`enableRedisTransport`) par les points
 * d'entrée du serveur (`createApp`, `initSocket`). Avant cela, publier est un no-op et
 * aucune souscription réseau n'est ouverte : un test unitaire qui importe un service ne
 * doit pas se retrouver connecté à Redis, ni retenir la boucle d'événements.
 */
const url = new URL(env.REDIS_URL);

export const redisConnectionOptions = {
  host: url.hostname,
  port: url.port ? Number(url.port) : 6379,
  username: url.username || undefined,
  password: url.password || undefined,
  db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  maxRetriesPerRequest: null,
} as const;

/**
 * Identifiant court de ce process. Il préfixe les entrées volatiles : une réplique
 * disparue laisse des entrées identifiables, que leur expiration finit par retirer.
 */
export const INSTANCE_ID = randomUUID().slice(0, 8);

/**
 * Sous-ensemble d'ioredis réellement utilisé par l'état volatil. Une seule méthode :
 * `call` couvre toutes les commandes (PUBLISH compris), ce qui rend le double de test
 * (`lib/redisFake`) petit et vérifiable.
 */
export interface RedisClientLike {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Une commande qui n'a pas répondu en une seconde est perdue. Sans borne, une panne Redis
 * ne rendrait pas la main : chaque requête HTTP attendrait la reconnexion.
 */
const COMMAND_TIMEOUT_MS = 1_000;
/** Une panne Redis émet une erreur par tentative de reconnexion : on n'en journalise qu'une. */
const ERROR_LOG_THROTTLE_MS = 30_000;
/** Période du battement de cœur (rafraîchissement des baux, réconciliation des miroirs). */
export const HEARTBEAT_INTERVAL_MS = 20_000;

function clientOptions(role: string, extra: RedisOptions = {}): RedisOptions {
  return {
    host: redisConnectionOptions.host,
    port: redisConnectionOptions.port,
    username: redisConnectionOptions.username,
    password: redisConnectionOptions.password,
    db: redisConnectionOptions.db,
    connectionName: `review-${role}-${INSTANCE_ID}`,
    maxRetriesPerRequest: 2,
    ...extra,
  };
}

const lastErrorLog = new Map<string, number>();

function attachErrorLogging(client: Redis, role: string): void {
  client.on('error', (err: unknown) => {
    const now = Date.now();
    if (now - (lastErrorLog.get(role) ?? 0) < ERROR_LOG_THROTTLE_MS) return;
    lastErrorLog.set(role, now);
    logger.warn({ err, role }, '[redis] connexion en défaut');
  });
}

let commandClient: Redis | null = null;
let subscriberClient: Redis | null = null;
const extraClients = new Set<Redis>();
let testDouble: RedisClientLike | null = null;
let transportEnabled = false;
let shutdownRegistered = false;

function ensureShutdownTask(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  registerShutdownTask({ name: 'redis', phase: SHUTDOWN_PHASE.DISCONNECT, run: closeRedis });
}

/** Client de commandes partagé (lazy). Le double de test le remplace intégralement. */
export function getRedis(): RedisClientLike {
  if (testDouble) return testDouble;
  if (!commandClient) {
    commandClient = new Redis(clientOptions('cmd', { commandTimeout: COMMAND_TIMEOUT_MS }));
    attachErrorLogging(commandClient, 'cmd');
    ensureShutdownTask();
  }
  return commandClient;
}

/**
 * Connexion dédiée (adapter Socket.io). Un client en mode `subscribe` est exclusif :
 * l'adapter en réclame deux, qui ne peuvent pas être le client de commandes.
 */
export function createRedisClient(role: string): Redis {
  const client = new Redis(clientOptions(role, { maxRetriesPerRequest: null }));
  attachErrorLogging(client, role);
  extraClients.add(client);
  ensureShutdownTask();
  return client;
}

// ── Pub/sub multiplexé ───────────────────────────────────────────────────────

type ChannelHandler = (payload: string) => void;
const handlers = new Map<string, Set<ChannelHandler>>();

function ensureSubscriber(): Redis {
  if (!subscriberClient) {
    subscriberClient = new Redis(clientOptions('sub', { maxRetriesPerRequest: null }));
    attachErrorLogging(subscriberClient, 'sub');
    subscriberClient.on('message', (channel: string, payload: string) => {
      dispatchRedisMessage(channel, payload);
    });
    ensureShutdownTask();
  }
  return subscriberClient;
}

function dispatchRedisMessage(channel: string, payload: string): void {
  for (const handler of handlers.get(channel) ?? []) {
    try {
      handler(payload);
    } catch (err) {
      logger.warn({ err, channel }, '[redis] gestionnaire de message en échec');
    }
  }
}

function openChannel(channel: string): void {
  if (!transportEnabled || testDouble) return;
  void ensureSubscriber()
    .subscribe(channel)
    .catch((err: unknown) => {
      logger.warn({ err, channel }, '[redis] souscription échouée');
    });
}

/**
 * Arme le transport pub/sub : ouvre les souscriptions déjà demandées et autorise les
 * publications. Appelé par les points d'entrée serveur, jamais par un module de logique.
 */
export function enableRedisTransport(): void {
  if (transportEnabled) return;
  transportEnabled = true;
  for (const channel of handlers.keys()) openChannel(channel);
}

/** Enregistre un gestionnaire de canal. La souscription réseau attend l'armement. */
export function subscribeRedis(channel: string, handler: ChannelHandler): void {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
    openChannel(channel);
  }
  set.add(handler);
}

/**
 * Publication best-effort : un canal de notification perdu se rattrape au battement de
 * cœur suivant (les miroirs se réconcilient), il ne doit jamais faire échouer l'appelant.
 */
export function publishRedis(channel: string, payload: string): void {
  if (!transportEnabled) return;
  void getRedis()
    .call('PUBLISH', channel, payload)
    .catch((err: unknown) => {
      logger.warn({ err, channel }, '[redis] publication échouée');
    });
}

// ── Battement de cœur partagé ────────────────────────────────────────────────

const heartbeatTasks = new Set<() => Promise<void>>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Exécute un tour de battement (exporté pour les tests : pas d'attente d'horloge). */
export async function runHeartbeat(): Promise<void> {
  for (const task of heartbeatTasks) {
    try {
      await task();
    } catch (err) {
      logger.warn({ err }, '[redis] battement de cœur en échec');
    }
  }
}

/**
 * Enregistre un travail périodique local au process : rafraîchir les baux d'expiration
 * des entrées de ce process, et réconcilier les miroirs de lecture. Ce n'est pas un
 * travail planifié (ceux-là sont en file BullMQ) : il n'a de sens que dans le process
 * qui détient les connexions, et ne doit pas s'exécuter deux fois.
 */
export function onHeartbeat(task: () => Promise<void>): void {
  heartbeatTasks.add(task);
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => void runHeartbeat(), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }
}

// ── Arrêt propre ─────────────────────────────────────────────────────────────

async function quit(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch (err) {
    logger.warn({ err }, '[redis] fermeture imparfaite');
    client.disconnect();
  }
}

/** Ferme toutes les connexions Redis du process (tâche d'extinction, phase DISCONNECT). */
export async function closeRedis(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const clients = [commandClient, subscriberClient, ...extraClients].filter((c): c is Redis => c !== null);
  commandClient = null;
  subscriberClient = null;
  extraClients.clear();
  await Promise.all(clients.map(quit));
}

// ── Utilitaires de lecture ───────────────────────────────────────────────────

/** Réponse tableau (HGETALL, ZRANGEBYSCORE, SMEMBERS, MGET…) normalisée en chaînes. */
export const redisStrings = (reply: unknown): string[] =>
  Array.isArray(reply) ? reply.map((v) => (v === null || v === undefined ? '' : String(v))) : [];

/** Réponse tableau de MGET : conserve les trous (`null`) pour distinguer clé absente. */
export const redisNullableStrings = (reply: unknown): (string | null)[] =>
  Array.isArray(reply) ? reply.map((v) => (typeof v === 'string' ? v : null)) : [];

/** Analyse défensive d'un enregistrement JSON stocké dans Redis (canal partagé). */
export function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Crochets de test : substitution du client et injection de messages pub/sub. */
export const __redisTesting = {
  setClient(client: RedisClientLike | null): void {
    testDouble = client;
  },
  deliver(channel: string, payload: string): void {
    dispatchRedisMessage(channel, payload);
  },
  runHeartbeat,
  reset(): void {
    testDouble = null;
    transportEnabled = false;
    handlers.clear();
    heartbeatTasks.clear();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  },
};
