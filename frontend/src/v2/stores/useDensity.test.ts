import { describe, it, expect, afterEach } from 'vitest';
import { useDensity } from './useDensity';

const attr = () => document.documentElement.getAttribute('data-density');

describe("useDensity — densité d'affichage (42.A1)", () => {
  afterEach(() => useDensity.getState().setDensity('comfortable'));

  it('applique data-density sur <html>', () => {
    // L'attribut est posé dès l'import (valeur initiale confortable par défaut).
    expect(attr()).toBe('comfortable');
  });

  it('passe en compact : attribut + persistance + état', () => {
    useDensity.getState().setDensity('compact');
    expect(useDensity.getState().density).toBe('compact');
    expect(attr()).toBe('compact');
    expect(localStorage.getItem('review:density')).toBe('compact');
  });

  it('revient en confortable', () => {
    useDensity.getState().setDensity('compact');
    useDensity.getState().setDensity('comfortable');
    expect(useDensity.getState().density).toBe('comfortable');
    expect(attr()).toBe('comfortable');
  });
});
