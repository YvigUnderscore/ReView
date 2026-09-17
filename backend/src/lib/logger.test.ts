// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { logger, prettyTransport } from './logger';

describe('logger', () => {
  it('expose une instance pino avec les méthodes de niveau usuelles', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('est silencieux en environnement de test (NODE_ENV=test, pas de bruit dans la suite)', () => {
    // Dérivation de niveau : test → silent (cf. lib/logger.ts).
    expect(logger.level).toBe('silent');
  });
});

/**
 * Le 2026-09-17, la pile docker de développement ne démarrait plus : l'image d'exécution
 * est construite sans les devDependencies (`npm ci --omit=dev`) et l'override de dev y pose
 * `NODE_ENV=development`. pino réclamait alors `pino-pretty`, absent, et levait AU
 * CHARGEMENT DU MODULE — le conteneur mourait avant la première ligne de log, sur un message
 * qui ne parlait ni de docker ni de NODE_ENV.
 */
describe('prettyTransport — l’embellisseur ne peut pas empêcher un démarrage', () => {
  const installed = () => true;
  const absent = () => false;

  it('embellit en développement quand le paquet est là', () => {
    expect(prettyTransport('development', installed)).toMatchObject({ target: 'pino-pretty' });
  });

  it('retombe sur le JSON quand le paquet manque, au lieu de lever', () => {
    expect(prettyTransport('development', absent)).toBeUndefined();
  });

  it('ne demande jamais l’embellisseur hors développement', () => {
    for (const env of ['production', 'test']) {
      expect(prettyTransport(env, installed)).toBeUndefined();
    }
  });

  // Hors développement, on ne doit même pas payer la résolution du module.
  it('ne cherche pas le paquet quand l’environnement ne s’y prête pas', () => {
    const probe = vi.fn(() => true);
    prettyTransport('production', probe);
    expect(probe).not.toHaveBeenCalled();
  });
});
