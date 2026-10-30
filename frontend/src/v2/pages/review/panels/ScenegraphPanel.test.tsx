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
import type { UsdModelInfo, UsdPrim } from '@/v2/types/api';

/**
 * The scenegraph of a production scene (F10/F18).
 *
 * A USD scene goes up to five thousand prims; the tree mounted all of them, each wrapped in its own
 * Radix context menu, and typing in the search expanded the whole tree, that is, mounted the maximum
 * possible number of rows at the most expensive moment.
 *
 * What is measured here: the number of mounted rows, the number of Radix triggers, the number of reads
 * of the variantSets list. Alongside, that nothing the user sees has changed (same labels, same
 * indentation, same selection gestures, same link between the viewer's selection and the highlighted row).
 */

vi.mock('./PrimMenuItems', () => ({
  default: ({ path }: { path: string }) => <div data-testid="prim-menu" data-path={path} />,
}));

/**
 * happy-dom lays nothing out: without sizes, the list would measure zero pixels and the virtualizer
 * would mount nothing. We give it a 400 px panel and rows of the estimated height, which is what the
 * browser measures for `text-xs` + `py-0.5`.
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
// Scrollable height = that of the virtualizer's spacer: this is what the browser measures, and what the
// list needs to know how far it can scroll.
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get(this: HTMLElement) {
    const spacer = this.firstElementChild as HTMLElement | null;
    const declared = spacer?.style.height ? Number.parseFloat(spacer.style.height) : 0;
    return Math.max(declared, heightOf(this));
  },
});
// happy-dom does not scroll: we model what the browser does when asked to scroll. The list moves and
// signals it, which the virtualizer needs in order to mount the row targeted by a selection coming from the viewer.
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

/** A production scene: forty groups of forty meshes, all expanded from the start. */
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

/** A scene object four levels deep: the last one is collapsed by default. */
const DEEP = buildPrimTree(
  ['/World', '/World/Chair', '/World/Chair/Geom', '/World/Chair/Geom/seat'].map(prim),
);
const SEAT = '/World/Chair/Geom/seat';

/** Minimal USD sheet: only the variant sets matter to the tree. */
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
    // Replaced by the real view state in `Harness`: the panel no longer holds its memory.
    view: { query: '', setQuery: vi.fn(), expanded: new Set<string>(), toggle: vi.fn(), expand: vi.fn() },
    dirty: false,
    localDelta: emptyOverride(),
    merged: emptyOverride(),
    ...over,
  };
}

/**
 * Search and expansion now live in the scene state (`useScenegraphView`), so that they survive the
 * panel being unmounted when switching dock tabs. The harness provides them for real: without that,
 * no chevron and no search would do anything here.
 */
function Harness({ scene, usd }: { scene: UsdSceneState; usd: UsdModelInfo | null }) {
  const view = useScenegraphView(scene.tree, 1);
  return <ScenegraphPanel scene={{ ...scene, view }} usd={usd} />;
}

const mount = (scene: UsdSceneState, usd: UsdModelInfo | null = USD) =>
  render(<Harness scene={scene} usd={usd} />);

/** Paths of the prims actually mounted, in DOM order. */
const mountedPaths = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-prim-path]')].map((n) => n.getAttribute('data-prim-path'));

const scroller = (el: HTMLElement) => el.querySelector('[data-state]') as HTMLElement;

describe('ScenegraphPanel — a production scene', () => {
  it('mounts only the visible window, without misrepresenting the volume of the tree', () => {
    const { container } = mount(fakeScene(TREE));
    const mountedRows = container.querySelectorAll('[data-index]');
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(60);
    const spacer = container.querySelector('div[style*="height"]');
    expect(spacer?.getAttribute('style')).toContain(`height: ${ROW_COUNT * ROW_ESTIMATE}px`);
  });

  it('mounts a single context menu for the whole tree', () => {
    const { container } = mount(fakeScene(TREE));
    // One Radix trigger per row was a portal, refs and a `useId` per prim.
    expect(container.querySelectorAll('[data-state]')).toHaveLength(1);
  });

  it('keeps the window bounded when the search expands the whole filtered tree', () => {
    const { container } = mount(fakeScene(TREE));
    const search = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'M1' } });
    // 440 meshes match (M1, M10…M19 in each group) and all their ancestors are expanded: the tree then
    // mounted those hundreds of rows at once, on every keystroke.
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(60);
    expect(mountedPaths(container).every((p) => p?.includes('M1') || !p?.includes('/M'))).toBe(true);
  });

  it('reads the variantSets list only once, not once per row', () => {
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

  it('reaches the rows at the bottom by scrolling', () => {
    // Everything is expanded: the order of the rows is that of the flat tree.
    const deep = flattenTree(TREE)[400];
    const { container } = mount(fakeScene(TREE));
    expect(mountedPaths(container)).not.toContain(deep);
    fireEvent.scroll(scroller(container), { target: { scrollTop: 400 * ROW_ESTIMATE } });
    expect(mountedPaths(container)).toContain(deep);
  });
});

describe('ScenegraphPanel — what the user sees has not changed', () => {
  it('shows the same labels and the same indentation', () => {
    const { container } = mount(fakeScene(TREE));
    const rows = [...container.querySelectorAll('[data-prim-path]')] as HTMLElement[];
    expect(rows[0].getAttribute('data-prim-path')).toBe('/World');
    expect(rows[0].textContent).toContain('World');
    expect(rows[0].style.paddingLeft).toBe('4px');
    // A group is at the first level, a mesh at the second: twelve pixels per step.
    const group = rows.find((r) => r.getAttribute('data-prim-path') === '/World/G0');
    expect(group?.style.paddingLeft).toBe('16px');
    const mesh = rows.find((r) => r.getAttribute('data-prim-path')?.includes('/M'));
    expect(mesh?.style.paddingLeft).toBe('28px');
  });

  it('badges prims carrying variants, with the name of the sets in the tooltip', () => {
    const { container } = mount(fakeScene(TREE));
    const badge = container.querySelector('[title="lookVariant"]');
    expect(badge?.textContent).toBe('var');
    expect(container.querySelectorAll('[title="lookVariant"]')).toHaveLength(1);
  });

  it('selects on click, toggles on Ctrl+click, takes the range on Shift+click', () => {
    const scene = fakeScene(TREE, { primary: '/World/G0' });
    const { container } = mount(scene);
    const row = (path: string) => container.querySelector(`[data-prim-path="${path}"]`) as HTMLElement;

    fireEvent.click(row('/World/G0'));
    expect(scene.select).toHaveBeenCalledWith('/World/G0', { additive: false });

    fireEvent.click(row('/World/G0/M0'), { ctrlKey: true });
    expect(scene.select).toHaveBeenCalledWith('/World/G0/M0', { additive: true });

    // The chevron collapses the group: its meshes no longer have any row at all.
    fireEvent.click(row('/World/G0').querySelector('button') as HTMLElement);
    expect(row('/World/G0/M0')).toBeNull();

    // The range nevertheless always follows the order of the **entire filtered** tree, not that of the
    // visible rows: the meshes collapsed between the two groups are part of it, as before.
    fireEvent.click(row('/World/G1'), { shiftKey: true });
    const range = vi.mocked(scene.selectMany).mock.calls[0][0];
    expect(range[0]).toBe('/World/G0');
    expect(range.at(-1)).toBe('/World/G1');
    expect(range).toHaveLength(MESHES + 2);
  });

  it('moves focus from one row to another with the arrows, beyond the mounted window', () => {
    const { container } = mount(fakeScene(TREE));
    const mountedRows = [...container.querySelectorAll('[data-index]')] as HTMLElement[];
    const last = mountedRows.at(-1) as HTMLElement;
    const nextIndex = Number(last.getAttribute('data-index')) + 1;
    expect(container.querySelector(`[data-index="${nextIndex}"]`)).toBeNull();

    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).getAttribute('data-index')).toBe(String(nextIndex));
  });

  it('scrolls to the prim selected in the viewer, even far down the tree', () => {
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

describe('ScenegraphPanel — search only expands the path to the result', () => {
  it('does not bring back the descendants of a found node', () => {
    // The default: the filter compared the PATH, so "G0" retained the forty meshes of `/World/G0`, and
    // the full expansion mounted them all. Searching for a group shows the group.
    const { container } = mount(fakeScene(TREE));
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'G0' } });
    expect(mountedPaths(container)).toEqual(['/World', '/World/G0']);
  });

  it('by contrast, opens the lineage leading to a deep result', () => {
    const { container } = mount(fakeScene(DEEP));
    // `seat` is under a collapsed `Geom`: the search must open it to show the result.
    expect(mountedPaths(container)).not.toContain(SEAT);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'seat' } });
    expect(mountedPaths(container)).toEqual(['/World', '/World/Chair', '/World/Chair/Geom', SEAT]);
  });
});

describe('ScenegraphPanel — `F` on hover reveals the selection', () => {
  /** The global camera framing: placed as a bubble listener on `window`, like `useFrameShortcuts`. */
  const watchWindow = () => {
    const framed = vi.fn();
    window.addEventListener('keydown', framed);
    return { framed, stop: () => window.removeEventListener('keydown', framed) };
  };
  /** The keystroke comes from the document body: nobody has focus in the tree. */
  const pressF = () => fireEvent.keyDown(document.body, { key: 'f' });

  it('expands to the prim selected in the viewer, and consumes the keystroke', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    expect(mountedPaths(container)).not.toContain(SEAT);
    const { framed, stop } = watchWindow();
    try {
      fireEvent.pointerEnter(root);
      pressF();
      expect(mountedPaths(container)).toContain(SEAT);
      // The camera does not also frame: the keystroke was consumed while hovering the tree.
      expect(framed).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('lifts the search when it hides the selected prim', () => {
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

  it('lets the keystroke through when not hovering: the viewer frames as before', () => {
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

  it('lets the keystroke through when nothing is selected', () => {
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

  it('does not steal the keystroke from the search field', () => {
    // Typing "seat" in the search means writing one more "f" somewhere: the letter belongs to the input,
    // and the tree must not expand under the fingers.
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(root);
    fireEvent.keyDown(container.querySelector('input') as HTMLInputElement, { key: 'f' });
    expect(mountedPaths(container)).not.toContain(SEAT);
  });

  it('ignores the keystroke when accompanied by a modifier', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    fireEvent.pointerEnter(container.firstElementChild as HTMLElement);
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(mountedPaths(container)).not.toContain(SEAT);
  });

  it('stops responding once the pointer has left', () => {
    const { container } = mount(fakeScene(DEEP, { primary: SEAT, selected: [SEAT] }));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(root);
    fireEvent.pointerLeave(root);
    pressF();
    expect(mountedPaths(container)).not.toContain(SEAT);
  });
});

describe('ScenegraphPanel — the single context menu', () => {
  it('offers the actions of the prim targeted by the right-click', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0"]') as HTMLElement);
    expect(document.querySelector('[data-testid="prim-menu"]')?.getAttribute('data-path')).toBe('/World/G0');
  });

  it('changes prim from one right-click to the next', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0"]') as HTMLElement);
    fireEvent.contextMenu(container.querySelector('[data-prim-path="/World/G0/M0"]') as HTMLElement);
    expect(document.querySelector('[data-testid="prim-menu"]')?.getAttribute('data-path')).toBe(
      '/World/G0/M0',
    );
  });

  it('opens nothing on a right-click outside a prim row', () => {
    const { container } = mount(fakeScene(TREE));
    fireEvent.contextMenu(scroller(container));
    expect(document.querySelector('[data-testid="prim-menu"]')).toBeNull();
  });
});

describe('ScenegraphPanel — row memoization', () => {
  it('does not replay the mounted rows on each render of the dock or on each scroll', () => {
    // A row's render is counted when its prim's name is read: `PrimRow` reads it once per render.
    // A scroll emits dozens per second.
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

    // The dock renders on every frame while the camera moves: the scene state is a new object, but its
    // members are the same, so no row has any reason to replay.
    for (let i = 0; i < 6; i += 1) rerender(<Harness scene={{ ...scene }} usd={USD} />);
    expect(reads).toBe(first);

    // Likewise for scrolling, which emits dozens of events per second.
    const list = scroller(container);
    for (let i = 1; i <= 5; i += 1) fireEvent.scroll(list, { target: { scrollTop: i } });
    expect(reads).toBe(first);
  });
});
