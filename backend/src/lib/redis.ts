import { env } from '../config/env';

/**
 * Options de connexion Redis pour BullMQ.
 *
 * On fournit des options (et non une instance ioredis) : BullMQ instancie son propre
 * client avec sa version bundlée d'ioredis, ce qui évite le conflit de types lié à la
 * présence de deux copies d'ioredis (dual-package hazard).
 *
 * `maxRetriesPerRequest: null` est requis par les workers BullMQ.
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
