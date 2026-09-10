// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { getSourceUrl } from '../lib/settings';
import { appVersion } from '../lib/version';
import { isShuttingDown } from '../lib/gracefulShutdown';
import { createReadinessCache, dependencyProbes, runChecks, READY_CACHE_MS } from '../lib/health';
// Réexport : la mécanique a déménagé dans lib/health, les appelants historiques (tests,
// écran d'administration système) continuent de la trouver ici.
export * from '../lib/health';

/**
 * Sondes de santé et version de l'instance.
 *
 * `GET /health` répondait « ok » sans rien toucher : un backend dont le pool de connexions
 * est mort restait « healthy » et continuait de recevoir du trafic. On sépare donc les deux
 * questions, qui n'ont pas les mêmes réponses :
 *
 *  - **vivacité** (`/health`, `/health/live`) — le process répond-il ? Aucune E/S, jamais
 *    d'échec sur une dépendance : c'est la sonde de `docker compose`, et redémarrer un
 *    conteneur parce que Postgres est tombé ne ferait qu'ajouter une panne à la panne ;
 *  - **disponibilité** (`/health/ready`) — l'instance peut-elle réellement servir ? Base,
 *    Redis et MinIO sont interrogés, chacun sous délai maximal ; toute dépendance en défaut
 *    donne un **503**, ce qu'un frontal ou une supervision externe savent lire.
 *
 * La sonde de disponibilité est bornée en charge par construction : chaque contrôle a un
 * délai, le résultat est mémorisé quelques secondes, et les appels concurrents partagent la
 * même exécution. Marteler `/health/ready` coûte donc, au pire, un aller-retour par
 * dépendance toutes les `READY_CACHE_MS` — sans quoi la sonde serait elle-même le vecteur
 * de charge qui achève une instance déjà en difficulté.
 *
 * Surface publique (aucune authentification) : elle porte donc, comme `/api/docs`, l'offre
 * de code source correspondant exigée par l'AGPL §13 — c'est aussi la seule façon pour un
 * utilisateur de savoir *quelles* sources correspondent à l'instance qu'il utilise.
 */
/** Vivacité : aucune E/S, aucune dépendance. Répond tant que la boucle d'événements tourne. */
const liveness = (): Record<string, unknown> => ({
  status: 'ok',
  version: appVersion.version,
  commit: appVersion.commit,
  uptimeSec: Math.round(process.uptime()),
});

/**
 * Construit le routeur de santé. Paramétrable pour que les tests éprouvent le 503 sans
 * dépendre de l'état mémorisé du routeur réel (le cache est justement partagé par tous les
 * appels : c'est ce qu'on veut en production, pas dans une suite de tests).
 */
export function buildHealthRouter(
  probes: Record<string, () => Promise<unknown>> = dependencyProbes,
  ttlMs = READY_CACHE_MS,
): Router {
  const readiness = createReadinessCache(() => runChecks(probes), ttlMs);
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(liveness());
  });

  router.get('/live', (_req, res) => {
    res.json(liveness());
  });

  router.get('/ready', async (_req, res) => {
    /*
     * Un process qui s'arrête n'est pas prêt, même si ses dépendances répondent encore.
     * L'arrêt propre laisse finir les requêtes en cours pendant quelques secondes ; sans
     * ce contrôle, la sonde répond 200 pendant tout ce délai et le frontal continue de
     * router du trafic neuf vers un process qui se vide — chaque requête envoyée là arrive
     * après la fermeture. C'est précisément à quoi sert `isShuttingDown`, qui existait sans
     * appelant : le drainage était écrit côté serveur, mais jamais annoncé au dehors.
     *
     * Avant la lecture des dépendances : l'état est certain et local, il n'y a rien à
     * attendre pour le savoir.
     */
    if (isShuttingDown()) {
      res.status(503).json({
        status: 'shutting-down',
        version: appVersion.version,
        commit: appVersion.commit,
      });
      return;
    }
    const report = await readiness();
    res.status(report.ok ? 200 : 503).json({
      status: report.ok ? 'ready' : 'degraded',
      version: appVersion.version,
      commit: appVersion.commit,
      cached: report.cached,
      checks: report.checks,
    });
  });

  return router;
}

export default buildHealthRouter();

/**
 * Version de l'instance, publique (`GET /api/version`) : le support, la supervision et
 * l'écran « À propos » de l'administration lisent la même source. Publier la version d'un
 * logiciel AGPL n'est pas une fuite — l'§13 impose au contraire de pouvoir désigner les
 * sources *correspondantes*, ce que le couple version + commit permet seul.
 */
export const versionRouter = Router();

versionRouter.get('/', async (_req, res) => {
  res.json({
    version: appVersion.version,
    commit: appVersion.commit,
    builtAt: appVersion.builtAt,
    node: process.version,
    source: await getSourceUrl(),
  });
});
