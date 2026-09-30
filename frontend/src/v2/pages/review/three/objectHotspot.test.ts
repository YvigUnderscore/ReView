// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createObjectMarker, raycastModelPoint, toMarkerPoint } from './objectHotspot';

/** Rayon au centre de l'image : le repli « poser au centre » a disparu, le NDC (0,0) reste. */
const atCenter = (camera: THREE.PerspectiveCamera, root: THREE.Object3D) =>
  raycastModelPoint(THREE, camera, root, { x: 0, y: 0 });

/** Caméra en (0,0,5) regardant l'origine — un plan unitaire y remplit le centre de l'image. */
function scene() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { camera, root, mesh };
}

describe('objectHotspot.raycastModelPoint', () => {
  it('pose le point là où l’on clique, pas au centre de l’écran', () => {
    const { camera, root } = scene();
    const center = atCenter(camera, root);
    const offset = raycastModelPoint(THREE, camera, root, { x: 0.5, y: 0 });
    expect(center?.position.split(' ').map(Number)[0]).toBeCloseTo(0);
    // Un clic à droite du centre touche la surface plus à droite : les deux hotspots diffèrent.
    expect(offset).not.toBeNull();
    expect(Number(offset!.position.split(' ')[0])).toBeGreaterThan(0.5);
    expect(offset!.space).toBe('object');
  });

  it('renvoie null quand le rayon ne touche rien', () => {
    const { camera, root } = scene();
    expect(raycastModelPoint(THREE, camera, root, { x: 0.99, y: 0.99 })).toBeNull();
  });

  it('ignore la géométrie masquée (option de variante cuite au même endroit)', () => {
    const { camera, root, mesh } = scene();
    mesh.visible = false;
    expect(atCenter(camera, root)).toBeNull();
  });

  it('exprime le point dans l’espace objet, donc il suit la transformation', () => {
    const { camera, root } = scene();
    root.position.set(1, 0, 0);
    root.updateMatrixWorld(true);
    const hs = atCenter(camera, root);
    // Le rayon touche le monde en x = 0 ; l'objet étant décalé de +1, le local vaut −1.
    expect(Number(hs!.position.split(' ')[0])).toBeCloseTo(-1);
  });
});

describe('objectHotspot.toMarkerPoint', () => {
  it('relit un point sérialisé et son espace', () => {
    const p = toMarkerPoint(THREE, { position: '1 2 3', normal: '0 0 1', space: 'object' });
    expect(p?.point.toArray()).toEqual([1, 2, 3]);
    expect(p?.objectSpace).toBe(true);
  });

  it('rejette une position inexploitable', () => {
    expect(toMarkerPoint(THREE, { position: 'x y z', normal: '0 0 1' })).toBeNull();
  });
});

describe('objectHotspot.createObjectMarker', () => {
  it('numérote une pastille par point et masque celles qui ne servent plus', () => {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    const at = (x: number) => ({ point: new THREE.Vector3(x, 0, 0), objectSpace: true });

    marker.update([at(0), at(1), at(-1)], camera, root, 800, 600);
    const dots = [...container.children] as HTMLElement[];
    expect(dots.map((d) => d.textContent)).toEqual(['1', '2', '3']);
    expect(dots.every((d) => d.style.display === 'flex')).toBe(true);

    // Un seul point : les pastilles surnuméraires disparaissent sans être détruites.
    marker.update([at(0)], camera, root, 800, 600);
    expect(dots.map((d) => d.style.display)).toEqual(['flex', 'none', 'none']);

    marker.update(null, camera, root, 800, 600);
    expect(dots.every((d) => d.style.display === 'none')).toBe(true);
    marker.remove();
    expect(container.children).toHaveLength(0);
  });

  it('masque un point situé derrière la caméra', () => {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    marker.update([{ point: new THREE.Vector3(0, 0, 50), objectSpace: false }], camera, root, 800, 600);
    expect((container.children[0] as HTMLElement).style.display).toBe('none');
  });
});

describe('objectHotspot.createObjectMarker — pastilles manipulables pendant la rédaction', () => {
  /** Pastille de rang 0, projetée à l'écran (elle n'existe dans le DOM qu'une fois rendue). */
  function dot() {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    marker.update([{ point: new THREE.Vector3(0, 0, 0), objectSpace: true }], camera, root, 800, 600);
    return { marker, el: container.children[0] as HTMLElement };
  }

  it('reste inerte tant qu’aucun gestionnaire n’est posé (relecture)', () => {
    const { el } = dot();
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('role')).toBeNull();
  });

  it('tirée, la pastille repose son point ; cliquée, elle le désigne', () => {
    const { marker, el } = dot();
    const onMove = vi.fn();
    const onSelect = vi.fn();
    marker.setInteractive({ onMove, onSelect, label: (i) => `Point ${i + 1}` });
    expect(el.getAttribute('aria-label')).toBe('Point 1');
    expect(el.className).not.toContain('pointer-events-none');

    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 11, clientY: 10, bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(onMove).not.toHaveBeenCalled();

    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 90, clientY: 70, bubbles: true }));
    expect(onMove).toHaveBeenCalledWith(0, 90, 70);
  });

  it('le geste sur une pastille n’atteint pas le canvas (ni orbite, ni point de plus)', () => {
    const { marker, el } = dot();
    marker.setInteractive({ onMove: vi.fn(), onSelect: vi.fn(), label: () => 'Point 1' });
    const seen = vi.fn();
    el.parentElement!.addEventListener('pointerdown', seen);
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('le rang mis en avant change de peau, et le désarmement rend l’inertie', () => {
    const { marker, el } = dot();
    marker.setInteractive({ onMove: vi.fn(), onSelect: vi.fn(), label: () => 'Point 1' });
    marker.setActive(0);
    expect(el.className).toContain('bg-background');
    marker.setInteractive(null);
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('aria-label')).toBeNull();
  });
});
