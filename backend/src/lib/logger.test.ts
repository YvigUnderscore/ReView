import { describe, it, expect } from 'vitest';
import { logger } from './logger';

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
