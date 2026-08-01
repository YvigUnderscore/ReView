import { describe, it, expect } from 'vitest';
import { CLICK_SLOP_PX, isClickGesture, primPathOf, toNdc } from './usdPicking';

/** Objet Three minimal : seuls `parent` et `userData` sont lus par `primPathOf`. */
const node = (userData: Record<string, unknown>, parent: unknown = null) => ({ userData, parent }) as never;

describe('isClickGesture', () => {
  it('accepte un pointeur quasi immobile', () => {
    expect(isClickGesture(0, 0)).toBe(true);
    expect(isClickGesture(2, 2)).toBe(true);
  });
  it('rejette un glissement — c’est une orbite, pas une sélection', () => {
    expect(isClickGesture(30, 0)).toBe(false);
    expect(isClickGesture(0, CLICK_SLOP_PX + 1)).toBe(false);
  });
});

describe('toNdc', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  it('place le centre à l’origine', () => {
    expect(toNdc(500, 250, rect)).toEqual({ x: 0, y: 0 });
  });

  it('inverse l’axe vertical (écran vers NDC)', () => {
    expect(toNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(toNdc(900, 450, rect)).toEqual({ x: 1, y: -1 });
  });

  it('reste défini sur un conteneur de taille nulle', () => {
    expect(toNdc(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('primPathOf', () => {
  it('remonte au premier ancêtre portant un chemin de prim', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const geo = node({}, asset);
    const mesh = node({}, geo);
    expect(primPathOf(mesh)).toBe('/World/Asset');
  });

  it('privilégie le chemin le plus proche du point touché', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const mesh = node({ usdPath: '/World/Asset/Geo/Suzanne' }, asset);
    expect(primPathOf(mesh)).toBe('/World/Asset/Geo/Suzanne');
  });

  it('renvoie null hors d’une scène USD', () => {
    expect(primPathOf(node({}, node({})))).toBeNull();
    expect(primPathOf(null)).toBeNull();
    // Un `usdPath` qui n'est pas un chemin absolu n'est pas un prim.
    expect(primPathOf(node({ usdPath: 'Suzanne' }))).toBeNull();
  });
});
