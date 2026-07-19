import { describe, it, expect } from 'vitest';
import { __testing } from './watermarkConfig';

const { sanitize, FALLBACK } = __testing;

describe('watermarkConfig.sanitize', () => {
  it('repli complet sur la base pour une entrée vide', () => {
    expect(sanitize(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });

  it('accepte des booléens et borne l’opacité', () => {
    const out = sanitize({ internal: true, shares: false, opacity: 0.9 }, FALLBACK);
    expect(out.internal).toBe(true);
    expect(out.shares).toBe(false);
    expect(out.opacity).toBe(0.4);
    expect(sanitize({ opacity: 0.001 }, FALLBACK).opacity).toBe(0.02);
  });

  it('ignore les types invalides', () => {
    const out = sanitize({ internal: 'oui', opacity: 'fort' }, FALLBACK);
    expect(out.internal).toBe(FALLBACK.internal);
    expect(out.opacity).toBe(FALLBACK.opacity);
  });
});
