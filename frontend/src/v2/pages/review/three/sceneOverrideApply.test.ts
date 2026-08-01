import { describe, it, expect } from 'vitest';
import { planOverride, renderedPrimPaths, type BaseState, type IndexedObject } from './sceneOverrideApply';
import { emptyOverride, setPrimEdit } from './sceneOverride';

const base = (over: Partial<BaseState> = {}): BaseState => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
  ...over,
});

const indexed = (entries: [string, Partial<BaseState>?][]): IndexedObject<string>[] =>
  entries.map(([primPath, b]) => ({ object: primPath, primPath, base: base(b) }));

describe('planOverride', () => {
  it('sans override, chaque objet garde son état d’origine', () => {
    const plans = planOverride(indexed([['/W/A', { position: [1, 2, 3] }]]), null);
    expect(plans[0]).toMatchObject({ position: [1, 2, 3], scale: [1, 1, 1], visible: true });
  });

  it('la translation et la rotation s’ajoutent, l’échelle se multiplie', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, Math.PI, 0], s: [2, 2, 2] },
    });
    const plans = planOverride(indexed([['/W/A', { position: [5, 0, 0], scale: [3, 3, 3] }]]), override);
    expect(plans[0]!.position).toEqual([6, 0, 0]);
    expect(plans[0]!.rotation[1]).toBeCloseTo(Math.PI);
    expect(plans[0]!.scale).toEqual([6, 6, 6]);
  });

  it('la visibilité forcée l’emporte, sinon celle d’origine est conservée', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', { visible: false });
    const plans = planOverride(indexed([['/W/A'], ['/W/B', { visible: false }]]), override);
    expect(plans[0]!.visible).toBe(false);
    expect(plans[1]!.visible).toBe(false);
  });

  it('n’applique le delta qu’au prim visé', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [9, 9, 9], r: [0, 0, 0], s: [1, 1, 1] },
    });
    const plans = planOverride(indexed([['/W/A'], ['/W/B']]), override);
    expect(plans[0]!.position).toEqual([9, 9, 9]);
    expect(plans[1]!.position).toEqual([0, 0, 0]);
  });

  it('est idempotent : replanifier depuis l’état d’origine ne cumule pas', () => {
    const items = indexed([['/W/A']]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0]!.position).toEqual([1, 0, 0]);
    expect(planOverride(items, override)[0]!.position).toEqual([1, 0, 0]);
  });

  it('revenir à un override vide rétablit l’état d’origine', () => {
    const items = indexed([['/W/A', { position: [4, 0, 0] }]]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 1, 1], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0]!.position).toEqual([5, 1, 1]);
    expect(planOverride(items, emptyOverride())[0]!.position).toEqual([4, 0, 0]);
  });
});

describe('variantes cuites dans le GLB (46.G)', () => {
  const defaults = { '/W/Asset': { modelingVariant: 'hero' } };
  const scene: IndexedObject<string>[] = [
    {
      object: 'hero',
      primPath: '/W/Asset/Geo',
      base: base(),
      variant: { prim: '/W/Asset', set: 'modelingVariant', option: 'hero' },
    },
    {
      object: 'lo',
      primPath: '/W/Asset/Geo',
      base: base(),
      variant: { prim: '/W/Asset', set: 'modelingVariant', option: 'lo' },
    },
    { object: 'commun', primPath: '/W/Asset', base: base() },
  ];

  it('seule l’option active est visible, l’autre est masquée', () => {
    const plans = planOverride(scene, null, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', true],
      ['lo', false],
      ['commun', true],
    ]);
  });

  it('changer de variante bascule la visibilité sans reconversion', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset', { variants: { modelingVariant: 'lo' } });
    const plans = planOverride(scene, override, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', false],
      ['lo', true],
      ['commun', true],
    ]);
  });

  it('une option non retenue reste masquée même si l’override la demande visible', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset/Geo', { visible: true });
    expect(planOverride(scene, override, defaults)[1]!.visible).toBe(false);
  });

  it('sans défaut connu, aucune option n’est retenue', () => {
    expect(planOverride(scene, null, {}).map((p) => p.visible)).toEqual([false, false, true]);
  });
});

describe('renderedPrimPaths', () => {
  it('déduplique les chemins des objets rendus', () => {
    expect(renderedPrimPaths(indexed([['/W/A'], ['/W/A'], ['/W/B']]))).toEqual(['/W/A', '/W/B']);
  });
});
