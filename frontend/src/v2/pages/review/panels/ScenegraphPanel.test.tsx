// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import ScenegraphPanel from './ScenegraphPanel';
import { ROW_ESTIMATE } from './scenegraphRows';
import { buildPrimTree, flattenTree, type PrimNode } from '../three/usdScenegraph';
import { emptyOverride } from '../three/sceneOverride';
import { useScenegraphView } from '../three/useScenegraphView';
import type { UsdSceneState } from '../three/useUsdScene';
import type { UsdModelInfo, UsdPrim } from '../../../types/api';

/**
 * Le scenegraph d'une scène de production (F10/F18).
 *
 * Une scène USD monte jusqu'à cinq mille prims ; l'arbre les montait tous, chacun enveloppé
 * de son propre menu contextuel Radix — et taper dans la recherche dépliait l'arbre entier,
 * c'est-à-dire montait le maximum de rangées possible au moment le plus coûteux.
 *
 * Ce qui est mesuré ici : le nombre de rangées montées, le nombre de déclencheurs Radix, le
 * nombre de lectures de la liste des variantSets — et, à côté, que rien de ce que voit
 * l'utilisateur n'a changé (mêmes libellés, même indentation, mêmes gestes de sélection,
 * même lien entre la sélection du viewer et la rangée mise en évidence).
 */

vi.mock('./PrimMenuItems', () => ({
  default: ({ path }: { path: string }) => <div data-testid="prim-menu" data-path={path} />,
}));

/**
 * happy-dom ne fait aucune mise en page : sans tailles, la liste mesurerait zéro pixel et le
 * virtualiseur ne monterait rien. On lui donne un panneau de 400 px et des rangées de la
 * hauteur estimée — ce que mesure le navigateur pour `text-xs` + `py-0.5`.
 */
const VIEWPORT = 400;
const heightOf = (el: Element) => (el.hasAttribute('data-index') ? ROW_ESTIMATE : VIEWPORT);
Element.prototype.getBoundingClientRect = function stubbedRect(this: Element) {
  const height = heightOf(this);
  return { x: 0, y: 0, top: 0, left: 0, right: 240, bottom: height, width: 240, height } as DOMRect;
};
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return heightOf(this);
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 240 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return heightOf(this);
  },
});
// Hauteur défilable = celle de la cale du virtualiseur : c'est ce que mesure le navigateur,
// et ce dont la liste a besoin pour savoir jusqu'où elle peut défiler.
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get(this: HTMLElement) {
    const spacer = this.firstElementChild as HTMLElement | null;
    const declared = spacer?.style.height ? Number.parseFloat(spacer.style.height) : 0;
    return Math.max(declared, heightOf(this));
  },
});
// happy-dom ne défile pas : on modélise ce que fait le navigateur quand on lui demande de
// défiler — la liste bouge et le signale, ce dont le virtualiseur a besoin pour monter la
// rangée visée par une sélection venue du viewer.
Element.prototype.scrollTo = function stubbedScrollTo(this: Element, options?: ScrollToOptions | number) {
  this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
  this.dispatchEvent(new Event('scroll'));
};

const prim = (path: string): UsdPrim => ({
  path,
  name: path.split('/').at(-1) ?? '',
  type: 'Xform',
  kind: '',
  purpose: '',
  variantSets: [],
  active: true,
  instanceable: false,
});

/** Une scène de production : quarante groupes de quarante meshes, tous dépliés d'emblée. */
const GROUPS = 40;
const MESHES = 40;
const ROW_COUNT = 1 + GROUPS + GROUPS * MESHES;
const makePrims = () => {
  const prims: UsdPrim[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    prims.push(prim(`/World/G${g}`));
    for (let m = 0; m < MESHES; m += 1) prims.push(prim(`/World/G${g}/M${m}`));
  }
  return prims;
};
const TREE = buildPrimTree(makePrims());

/** Un objet de scène à quatre niveaux : le dernier est replié par défaut. */
const DEEP = buildPrimTree(
  ['/World', '/World/Chair', '/World/Chair/Geom', '/World/Chair/Geom/seat'].map(prim),
);
const SEAT = '/World/Chair/Geom/seat';

/** Fiche USD minimale : seuls les jeux de variantes intéressent l'arbre. */
const usdWith = (variantSets: UsdModelInfo['variantSets']): UsdModelInfo => ({
  rootLayer: 'scene.usda',
  defaultPrim: '/World',
  upAxis: 'Y',
  metersPerUnit: 1,
  frameRange: null,
  fps: null,
  hasAnimation: false,
  hasSkeleton: false,
  variantSets,
  purposes: [],
  selection: { variants: {}, purpose: 'render' },
  selectionApplied: true,
  missingAssets: [],
  missingAssetsTotal: 0,
  layerCount: 1,
  primCount: 0,
  prims: [],
  primsTruncated: false,
});
const USD = usdWith([
  { prim: '/World/G0', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
]);

function fakeScene(tree: PrimNode[], over: Partial<UsdSceneState> = {}): UsdSceneState {
  return {
    tree,
    renderedPaths: new Set<string>(),
    override: emptyOverride(),
    variantDefaults: {},
    selected: [],
    primary: null,
    select: vi.fn(),
    selectMany: vi.fn(),
    resolvePrim: () => null,
    resolvePick: () => null,
    locked: new Set<string>(),
    toggleLock: vi.fn(),
    selectedObjects: () => [],
    representatives: () => [],
    selectedObject: null,
    commitPrimTransforms: () => [],
    applyPrimTransform: vi.fn(),
    duplicatePrim: () => null,
    deleteClone: vi.fn(),
    alignSelected: vi.fn(),
    distributeSelected: vi.fn(),
    setPrim: vi.fn(),
    isolate: vi.fn(),
    setVariant: vi.fn(),
    variantChoiceRenderable: () => true,
    revert: vi.fn(),
    // Remplacée par le vrai état de vue dans `Harness` : le panneau n'en porte plus la mémoire.
    view: { query: '', setQuery: vi.fn(), expanded: new Set<string>(), toggle: vi.fn(), expand: vi.fn() },
    dirty: false,
    localDelta: emptyOverride(),
    merged: emptyOverride(),
    ...over,
  };
}

/**
 * Recherche et dépliage vivent désormais dans l'état de scène (`useScenegraphView`), pour
 * survivre au démontage du panneau quand on change d'onglet du dock. Le harnais les fournit
 * pour de vrai : sans cela, aucun chevron ni aucune recherche ne ferait rien ici.
 */
function Harness({ scene, usd }: { scene: UsdSceneState; usd: UsdModelInfo | null }) {
  const view = useScenegraphView(scene.tree, 1);
  return <ScenegraphPanel scene={{ ...scene, view }} usd={usd} />;
}

const mount = (scene: UsdSceneState, usd: UsdModelInfo | null = USD) =>
  render(<Harness scene={scene} usd={usd} />);

/** Chemins des prims réellement montés, dans l'ordre du DOM. */
const mountedPaths = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-prim-path]')].map((n) => n.getAttribute('data-prim-path'));

const scroller = (el: HTMLElement) => el.querySelector('[data-state]') as HTMLElement;

describe('ScenegraphPanel — une scène de production', () => {
  it('ne monte que la fenêtre visible, sans mentir sur le volume de l’arbre', () => {
    const { container } = mount(fakeScene(TREE));
    const mountedRows = container.querySelectorAll('[data-index]');
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(60);
    const spacer = container.querySelector('div[style*="height"]');
    expect(spacer?.getAttribute('style')).toContain(`height: ${ROW_COUNT * ROW_ESTIMATE}px`);
  });

  it('ne monte qu’un seul menu contextuel pour tout l’arbre', () => {
    const { container } = mount(fakeScene(TREE));
    // Un déclencheur Radix par rangée, c'était un portail, des refs et un `useId` par prim.
    expect(container.querySelectorAll('[data-state]')).toHaveLength(1);
  });

  it('garde la fenêtre bornée quand la recherche déplie tout l’arbre filtré', () => {
    const { container } = mount(fakeScene(TREE));
    const search = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'M1' } });
    // 440 meshes correspondent (M1, M10…M19 dans chaque groupe) et tous leurs ancêtres sont
    // dépliés : l'arbre montait alors ces centaines de rangées d'un coup, à chaque frappe.
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(60);
    expect(mountedPaths(container).every((p) => p?.includes('M1') || !p?.includes('/M'))).toBe(true);
  });

  it('ne lit la liste des variantSets qu’une fois, et non une fois par rangée', () => {
    let reads = 0;
    const sets = USD.variantSets;
    const watched: UsdModelInfo = {
      ...USD,
      get variantSets() {
        reads += 1;
        return sets;
      },
    };
    mount(fakeScene(TREE), watched);
    expect(reads).toBe(1);
  });

  it('atteint les rangées du fond en faisant défiler', () => {
    // Tout est déplié : l'ordre des rangées est celui de l'arbre à plat.
    const deep = flattenTree(TREE)[400];
    const { container } = mount(fakeScene(TREE));
    expect(mountedPaths(container)).not.toContain(deep);
    fireEvent.scroll(scroller(container), { target: { scrollTop: 400 * ROW_ESTIMATE } });
    expect(mountedPaths(container)).toContain(deep);
  });
});

describe('ScenegraphPanel — ce que voit l’utilisateur n’a pas changé', () => {
  it('montre les mêmes libellés et la même indentation', () => {
    const { container } = mount(fakeScene(TREE));
    const rows = [...container.querySelectorAll('[data-prim-path]')] as HTMLElement[];
    expect(rows[0].getAttribute('data-prim-path')).toBe('/World');
    expect(rows[0].textContent).toContain('World');
    expect(rows[0].style.paddingLeft).toBe('4px');
    // Un groupe est au premier niveau, un mesh au second : douze pixels par cran.
    const group = rows.find((r) => r.getAttribute('data-prim-path') === '/World/G0');
    expect(group?.style.paddingLeft).toBe('16px');
    const mesh = rows.find((r) => r.getAttribute('data-prim-path')?.includes('/M'));
    expect(mesh?.style.paddingLeft).toBe('28px');
  });

  it('badge les prims porteurs de variantes, avec le nom des jeux en infobulle', () => {
    const { container } = mount(fakeScene(TREE));
    const badge = container.querySelector('[title="lookVariant"]');
    expect(badge?.textContent).toBe('var');
    expect(container.querySelectorAll('[title="lookVariant"]')).toHaveLength(1);
  });

  it('sélectionne au clic, bascule au Ctrl+clic, prend la plage au Maj+clic', () => {
    const scene = fakeScene(TREE, { primary: '/World/G0' });
    const { container } = mount(scene);
    const row = (path: string) => container.querySelector(`[data-prim-path="${path}"]`) as HTMLElement;

    fireEvent.click(row('/World/G0'));
    expect(scene.select).toHaveBeenCalledWith('/World/G0', { additive: false });

    fireEvent.click(row('/World/G0/M0'), { ctrlKey: true });
    expect(scene.select).toHaveBeenCalledWith('/World/G0/M0', { additive: true });

    // Le chevron replie le groupe : ses meshes n'ont plus de rangée du tout.
    fireEvent.click(row('/World/G0').querySelector('button') as HTMLElement);
    expect(row('/World/G0/M0')).toBeNull();

    // La plage suit pourtant toujours l'ordre de l'arbre **filtré entier**, pas celui des
    // rangées visibles : les meshes repliés entre les deux groupes en font partie, comme avant.
    fireEvent.click(row('/World/G1'), { shiftKey: true });
    const range = vi.mocked(scene.selectMany).mock.calls[0][0];
    expect(range[0]).toBe('/World/G0');
    expect(range.at(-1)).toBe('/World/G1');
    expect(range).toHaveLength(MESHES + 2);
  });

  it('déplace le focus d’une rangée à l’autre aux flèches, par-delà la fenêtre montée', () => {
    const { container } = mount(fakeScene(TREE));
    const mountedRows = [...container.querySelectorAll('[data-index]')] as HTMLElement[];
    const last = mountedRows.at(-1) as HTMLElement;
    const nextIndex = Number(last.getAttribute('data-index')) + 1;
    expect(container.querySelector(`[data-index="${nextIndex}"]`)).toBeNull();

    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).getAttribute('data-index')).toBe(String(nextIndex));
  });

  it('fait défiler jusqu’au prim sélectionné dans le viewer, même loin dans l’arbre', () => {
    const scene = fakeScene(TREE);
    const { container, rerender } = mount(scene);
    const far = TREE[0].children.at(-1)?.children.at(-1)?.path as string;
    expect(mountedPaths(container)).not.toContain(far);

    const selected = fakeScene(TREE, { primary: far, selected: [far] });
    rerender(<Harness scene={selected} usd={USD} />);
    expect(mountedPaths(container)).toContain(far);
    const row = container.querySelector(`[data-prim-path="${far}"]`) as HTMLElement;
    expect(row.className).toContain('bg-primary/20');
  });
});

describe('ScenegraphPanel — la recherche ne déplie que le chemin du résultat', () => {
  it('ne ramène pas la descendance d’un nœud trouvé', () => {
    // Le défaut : le filtre comparait le CHEMIN, donc « G0 » retenait les quarante meshes de
    // `/World/G0`, et le dépliage total les montait tous. Chercher un groupe montre le groupe.
    const { container } = mount(fakeScene(TREE));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'G0' } });
    expect(mountedPaths(container)).toEqual(['/World', '/World/G0']);
  });

  it('ouvre en revanche la lignée qui mène à un résultat profond', () => {
    const { container } = mount(fakeScene(DEEP));
    // `seat` est sous un `Geom` replié : la recherche doit l'ouvrir pour montrer le résultat.
    expect(mountedPaths(container)).not.toContain(SEAT);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'seat' } });
    expect(mountedPaths(container)).toEqual(['/World', '/World/Chair', '/World/Chair/Geom', SEAT]);
  });
});

describe('ScenegraphPanel — `F` au survol révèle la sélection', () => {
  /** Le cadrage caméra global : posé en bulle sur `window`, comme `useFrameShortcuts`. */
  const watchWindow = () => {
    const framed = vi.fn();
    window.addEventListener('keydown', framed);
    return { framed, stop: () => window.removeEventListener('keydown', framed) };
  };
  /** La frappe part du corps du document : personne n'a le focus dans l'arbre. */
  const pressF = () => fireEvent.keyDown(document.body, { key: 'f' });

  it('déplie jusqu’au prim sélectionné dans le viewer, et retient la frappe', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    expect(mountedPaths(container)).not.toContain(SEAT);
    const { framed, stop } = watchWindow();
    try {
      fireEvent.pointerEnter(root);
      pressF();
      expect(mountedPaths(container)).toContain(SEAT);
      // La caméra ne cadre pas en plus : la frappe a été consommée au survol de l'arbre.
      expect(framed).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('lève la recherche quand elle cache le prim sélectionné', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    const search = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Chair' } });
    expect(mountedPaths(container)).not.toContain(SEAT);
    fireEvent.pointerEnter(root);
    pressF();
    expect(search.value).toBe('');
    expect(mountedPaths(container)).toContain(SEAT);
  });

  it('laisse filer la frappe hors du survol — le viewer cadre comme avant', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const { framed, stop } = watchWindow();
    try {
      pressF();
      expect(framed).toHaveBeenCalled();
      expect(mountedPaths(container)).not.toContain(SEAT);
    } finally {
      stop();
    }
  });

  it('laisse filer la frappe sans rien de sélectionné', () => {
    const { container } = mount(fakeScene(DEEP));
    const root = container.firstElementChild as HTMLElement;
    const { framed, stop } = watchWindow();
    try {
      fireEvent.pointerEnter(root);
      pressF();
      expect(framed).toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('ne vole pas la frappe au champ de recherche', () => {
    // Taper « seat » dans la recherche, c'est écrire un « f » de plus quelque part : la lettre
    // appartient à la saisie, et l'arbre ne doit pas se déplier sous les doigts.
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(root);
    fireEvent.keyDown(container.querySelector('input') as HTMLInputElement, { key: 'f' });
    expect(mountedPaths(container)).not.toContain(SEAT);
  });

  it('ignore la frappe accompagnée d’un modificateur', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    fireEvent.pointerEnter(container.firstElementChild as HTMLElement);
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(mountedPaths(container)).not.toContain(SEAT);
  });

  it('cesse de répondre une fois le pointeur sorti', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(root);
    fireEvent.pointerLeave(root);
    pressF();
    expect(mountedPaths(container)).not.toContain(SEAT);
  });
});

describe('ScenegraphPanel — le menu contextuel unique', () => {
  it('propose les actions du prim visé par le clic droit', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0"]') as HTMLElement);
    expect(document.querySelector('[data-testid="prim-menu"]')?.getAttribute('data-path')).toBe('/World/G0');
  });

  it('change de prim d’un clic droit à l’autre', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0"]') as HTMLElement);
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0/M0"]') as HTMLElement);
    expect(document.querySelector('[data-testid="prim-menu"]')?.getAttribute('data-path')).toBe(
      '/World/G0/M0',
    );
  });

  it('n’ouvre rien sur un clic droit hors d’une rangée de prim', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(scroller(container));
    expect(document.querySelector('[data-testid="prim-menu"]')).toBeNull();
  });
});

describe('ScenegraphPanel — mémoïsation des rangées', () => {
  it('ne rejoue pas les rangées montées à chaque rendu du dock ni à chaque défilement', () => {
    // Le rendu d'une rangée se compte à la lecture du nom de son prim : `PrimRow` le lit une
    // fois par rendu. Un défilement en émet des dizaines par seconde.
    const tree = buildPrimTree(makePrims());
    const watched = tree[0].children[0];
    const label = watched.name;
    let reads = 0;
    Object.defineProperty(watched, 'name', {
      configurable: true,
      get: () => {
        reads += 1;
        return label;
      },
    });

    const scene = fakeScene(tree);
    const { container, rerender } = mount(scene);
    const first = reads;
    expect(first).toBeGreaterThan(0);

    // Le dock se rend à chaque image pendant que la caméra bouge : l'état de scène est un
    // objet neuf, mais ses membres sont les mêmes — aucune rangée n'a de raison de rejouer.
    for (let i = 0; i < 6; i += 1) rerender(<Harness scene={{ ...scene }} usd={USD} />);
    expect(reads).toBe(first);

    // Idem pour le défilement, qui émet des dizaines d'événements par seconde.
    const list = scroller(container);
    for (let i = 1; i <= 5; i += 1) fireEvent.scroll(list, { target: { scrollTop: i } });
    expect(reads).toBe(first);
  });
});
