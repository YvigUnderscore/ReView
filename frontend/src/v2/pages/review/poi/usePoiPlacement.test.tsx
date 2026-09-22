// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { MarkerHandlers } from '../three/objectHotspot';
import type { Hotspot3D } from '../reviewTypes';
import { usePoiDraft, type PoiDraftState } from './usePoiDraft';
import { usePoiPlacement, type PoiViewer } from './usePoiPlacement';

/**
 * Parité 3D / splat : les deux viewers remplissent LE MÊME contrat (`PoiViewer`) et passent par
 * LE MÊME hook. Les deux stubs ne diffèrent donc que par leur nom et par la façon de répondre au
 * rayon — exactement ce qui les distingue en vrai (triangles d'un côté, nuage de l'autre).
 */
function viewerStub(name: string) {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  // Le splat rend un point en espace objet, le modèle 3D aussi : c'est la règle du rejeu pour
  // tous. Le stub encode la position du pointeur pour que le test la reconnaisse.
  const pick = vi.fn((x: number, y: number): Hotspot3D | null =>
    x < 0 ? null : { position: `${x} ${y} 0`, normal: '0 0 1', space: 'object' },
  );
  let handlers: MarkerHandlers | null = null;
  const active: (number | null)[] = [];
  const viewer: PoiViewer = {
    ready: true,
    getSceneHandle: () => ({ dom }),
    hotspotAtPointer: pick,
    setPoiHandlers: (h) => {
      handlers = h;
    },
    setPoiActive: (i) => active.push(i),
  };
  return { name, dom, pick, viewer, active, markerHandlers: () => handlers };
}

function mount(stub: ReturnType<typeof viewerStub>, armed = true, showingDraft = true) {
  const onExit = vi.fn();
  const hook = renderHook(
    ({ isArmed }: { isArmed: boolean }) => {
      const poi = usePoiDraft();
      usePoiPlacement({ viewer: stub.viewer, armed: isArmed, poi, showingDraft, onExit });
      return poi;
    },
    { initialProps: { isArmed: armed } },
  );
  return { hook, onExit, poi: (): PoiDraftState => hook.result.current };
}

/** Clic gauche immobile dans la vue — le geste qui pose un point. */
function clickAt(dom: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(dom, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(dom, { button: 0, clientX: x, clientY: y });
}

describe.each([viewerStub('modèle 3D'), viewerStub('splat')])(
  'usePoiPlacement — $name : armer l’outil, c’est être en placement',
  (stub) => {
    it('le clic dans la vue pose un point, sans bouton intermédiaire', () => {
      const { poi } = mount(stub);
      expect(poi().points).toHaveLength(0);
      act(() => clickAt(stub.dom, 40, 60));
      expect(stub.pick).toHaveBeenCalledWith(40, 60);
      expect(poi().points).toHaveLength(1);
      expect(poi().points[0].position).toBe('40 60 0');
      // Espace objet : le point se rejoue pour tout spectateur, transformation comprise.
      expect(poi().points[0].space).toBe('object');
    });

    it('plusieurs points dans un même geste de rédaction, numérotés dans l’ordre de pose', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, 10, 10));
      act(() => clickAt(stub.dom, 20, 20));
      act(() => clickAt(stub.dom, 30, 30));
      expect(poi().points.map((p) => p.position)).toEqual(['10 10 0', '20 20 0', '30 30 0']);
      // Le dernier posé est celui qu'on édite, et la scène le signale au même rang.
      expect(poi().activeKey).toBe(poi().points[2].key);
    });

    it('ne pose rien au clic dans le vide, et un glissement reste une orbite', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, -1, -1));
      expect(poi().points).toHaveLength(0);
      act(() => {
        fireEvent.pointerDown(stub.dom, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(stub.dom, { button: 0, clientX: 120, clientY: 90 });
      });
      expect(poi().points).toHaveLength(0);
    });

    it('outil au repos : le clic ne pose plus rien', () => {
      const { poi, hook } = mount(stub, false);
      act(() => clickAt(stub.dom, 15, 15));
      expect(poi().points).toHaveLength(0);
      hook.rerender({ isArmed: true });
      act(() => clickAt(stub.dom, 15, 15));
      expect(poi().points).toHaveLength(1);
    });

    it('Échap rend l’outil de repos au rail', () => {
      const { onExit } = mount(stub);
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('les pastilles ne deviennent manipulables qu’avec un point en préparation', () => {
      const { poi } = mount(stub);
      expect(stub.markerHandlers()).toBeNull();
      act(() => clickAt(stub.dom, 12, 12));
      expect(stub.markerHandlers()).not.toBeNull();
      // Tirée ailleurs, la pastille repose son point ; cliquée, elle le désigne.
      act(() => stub.markerHandlers()!.onMove(0, 90, 70));
      expect(poi().points[0].position).toBe('90 70 0');
      act(() => poi().setActiveKey(null));
      act(() => stub.markerHandlers()!.onSelect(0));
      expect(poi().activeKey).toBe(poi().points[0].key);
      // Le rang mis en avant est publié à la scène : la rangée et la pastille disent le même point.
      expect(stub.active.at(-1)).toBe(0);
    });

    it('les pastilles d’un commentaire RELU restent inertes, brouillon ou pas', () => {
      const { poi } = mount(stub, true, false);
      act(() => clickAt(stub.dom, 12, 12));
      expect(poi().points).toHaveLength(1);
      // Ce sont les points du commentaire sélectionné qui sont à l'écran : tirer la pastille
      // n° 1 déplacerait un point du brouillon que l'on ne voit pas.
      expect(stub.markerHandlers()).toBeNull();
    });

    it('un point se supprime tant que le commentaire n’est pas envoyé', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, 1, 1));
      act(() => clickAt(stub.dom, 2, 2));
      act(() => poi().remove(poi().points[0].key));
      expect(poi().points.map((p) => p.position)).toEqual(['2 2 0']);
      act(() => poi().clear());
      expect(poi().points).toHaveLength(0);
      expect(stub.markerHandlers()).toBeNull();
    });
  },
);
