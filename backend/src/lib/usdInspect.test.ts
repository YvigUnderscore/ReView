import { describe, it, expect } from 'vitest';
import {
  extractJsonLine,
  parseUsdScan,
  parseUsdStageInfo,
  sanitizeVariantSelection,
  type UsdVariantSet,
} from './usdInspect';

const stageJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    root: 'scene.usda',
    stagePath: '/tmp/x/scene.usda',
    defaultPrim: '/World',
    upAxis: 'Y',
    metersPerUnit: 0.01,
    startTimeCode: 1,
    endTimeCode: 96,
    timeCodesPerSecond: 24,
    hasAnimation: true,
    hasSkeleton: false,
    variantSets: [],
    appliedVariants: [],
    purposes: ['default'],
    missingAssets: [],
    missingAssetsTotal: 0,
    layerCount: 3,
    primCount: 42,
    ...over,
  });

describe('extractJsonLine', () => {
  it('retient la dernière ligne JSON et ignore le bruit', () => {
    const out = 'Warning: plugin obsolète\n{"layers": []}\n';
    expect(extractJsonLine(out)).toBe('{"layers": []}');
    expect(extractJsonLine('{"a":1}\n{"b":2}')).toBe('{"b":2}');
  });

  it('échoue explicitement sans sortie JSON', () => {
    expect(() => extractJsonLine('rien du tout')).toThrow(/aucune sortie JSON/);
    expect(() => extractJsonLine('')).toThrow();
  });
});

describe('parseUsdScan', () => {
  it('lit le graphe de couches et complète les dépendances absentes', () => {
    const layers = parseUsdScan('{"layers":[{"layer":"scene.usda","deps":["a.usdc"]},{"layer":"a.usdc"}]}');
    expect(layers).toEqual([
      { layer: 'scene.usda', deps: ['a.usdc'] },
      { layer: 'a.usdc', deps: [] },
    ]);
  });

  it('rejette une sortie mal formée', () => {
    expect(() => parseUsdScan('{"layers":[{"deps":[]}]}')).toThrow(/graphe de couches invalide/);
  });
});

describe('parseUsdStageInfo', () => {
  it('lit une description complète', () => {
    const info = parseUsdStageInfo(stageJson());
    expect(info.root).toBe('scene.usda');
    expect(info.metersPerUnit).toBe(0.01);
    expect(info.hasAnimation).toBe(true);
  });

  it('normalise l’axe haut sur Y ou Z', () => {
    expect(parseUsdStageInfo(stageJson({ upAxis: 'Z' })).upAxis).toBe('Z');
    expect(parseUsdStageInfo(stageJson({ upAxis: 'y' })).upAxis).toBe('Y');
    expect(parseUsdStageInfo(stageJson({ upAxis: 'inconnu' })).upAxis).toBe('Y');
  });

  it('déduplique les variantSets et les assets manquants', () => {
    const info = parseUsdStageInfo(
      stageJson({
        variantSets: [
          { prim: '/W/A', name: 'look', options: ['a', 'b'], selected: 'a' },
          { prim: '/W/A', name: 'look', options: ['a', 'b'], selected: 'a' },
          { prim: '/W/B', name: 'look', options: ['a'], selected: 'a' },
        ],
        missingAssets: ['tex/diffuse.exr', 'tex/diffuse.exr', 'tex/rough.exr'],
      }),
    );
    expect(info.variantSets).toHaveLength(2);
    expect(info.missingAssets).toEqual(['tex/diffuse.exr', 'tex/rough.exr']);
  });

  it('rejette une description sans couche racine', () => {
    expect(() => parseUsdStageInfo('{"stagePath":"/tmp/x"}')).toThrow(/description de scene invalide/);
  });
});

describe('sanitizeVariantSelection', () => {
  const known: UsdVariantSet[] = [
    { prim: '/W/Asset', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
    { prim: '/W/Asset', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
  ];

  it('conserve uniquement les sélections réellement offertes par la scène', () => {
    expect(
      sanitizeVariantSelection(
        {
          '/W/Asset': { modelingVariant: 'lo', lookVariant: 'inexistant', autre: 'x' },
          '/W/Inconnu': { modelingVariant: 'hero' },
        },
        known,
      ),
    ).toEqual({ '/W/Asset': { modelingVariant: 'lo' } });
  });

  it('renvoie un objet vide quand rien ne correspond', () => {
    expect(sanitizeVariantSelection({ '/X': { y: 'z' } }, known)).toEqual({});
    expect(sanitizeVariantSelection({}, known)).toEqual({});
  });
});
