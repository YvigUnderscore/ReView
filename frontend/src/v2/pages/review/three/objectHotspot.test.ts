// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createObjectMarker, raycastModelPoint, toMarkerPoint } from './objectHotspot';

/** Radius at the center of the image: the "place at center" fallback is gone, NDC (0,0) remains. */
const atCenter = (camera: THREE.PerspectiveCamera, root: THREE.Object3D) =>
  raycastModelPoint(THREE, camera, root, { x: 0, y: 0 });

/** Camera at (0,0,5) looking at the origin — a unit plane fills the center of the image. */
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
  it('places the point where one clicks, not at the center of the screen', () => {
    const { camera, root } = scene();
    const center = atCenter(camera, root);
    const offset = raycastModelPoint(THREE, camera, root, { x: 0.5, y: 0 });
    expect(center?.position.split(' ').map(Number)[0]).toBeCloseTo(0);
    // A click right of center hits the surface further right: the two hotspots differ.
    expect(offset).not.toBeNull();
    expect(Number(offset!.position.split(' ')[0])).toBeGreaterThan(0.5);
    expect(offset!.space).toBe('object');
  });

  it('returns null when the ray hits nothing', () => {
    const { camera, root } = scene();
    expect(raycastModelPoint(THREE, camera, root, { x: 0.99, y: 0.99 })).toBeNull();
  });

  it('ignores hidden geometry (variant option baked in the same place)', () => {
    const { camera, root, mesh } = scene();
    mesh.visible = false;
    expect(atCenter(camera, root)).toBeNull();
  });

  it('expresses the point in object space, so it follows the transform', () => {
    const { camera, root } = scene();
    root.position.set(1, 0, 0);
    root.updateMatrixWorld(true);
    const hs = atCenter(camera, root);
    // The ray hits the world at x = 0; the object being offset by +1, the local value is −1.
    expect(Number(hs!.position.split(' ')[0])).toBeCloseTo(-1);
  });
});

describe('objectHotspot.toMarkerPoint', () => {
  it('reads back a serialized point and its space', () => {
    const p = toMarkerPoint(THREE, { position: '1 2 3', normal: '0 0 1', space: 'object' });
    expect(p?.point.toArray()).toEqual([1, 2, 3]);
    expect(p?.objectSpace).toBe(true);
  });

  it('rejects an unusable position', () => {
    expect(toMarkerPoint(THREE, { position: 'x y z', normal: '0 0 1' })).toBeNull();
  });
});

describe('objectHotspot.createObjectMarker', () => {
  it('numbers one marker per point and hides those no longer used', () => {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    const at = (x: number) => ({ point: new THREE.Vector3(x, 0, 0), objectSpace: true });

    marker.update([at(0), at(1), at(-1)], camera, root, 800, 600);
    const dots = [...container.children] as HTMLElement[];
    expect(dots.map((d) => d.textContent)).toEqual(['1', '2', '3']);
    expect(dots.every((d) => d.style.display === 'flex')).toBe(true);

    // A single point: the surplus markers disappear without being destroyed.
    marker.update([at(0)], camera, root, 800, 600);
    expect(dots.map((d) => d.style.display)).toEqual(['flex', 'none', 'none']);

    marker.update(null, camera, root, 800, 600);
    expect(dots.every((d) => d.style.display === 'none')).toBe(true);
    marker.remove();
    expect(container.children).toHaveLength(0);
  });

  it('hides a point behind the camera', () => {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    marker.update([{ point: new THREE.Vector3(0, 0, 50), objectSpace: false }], camera, root, 800, 600);
    expect((container.children[0] as HTMLElement).style.display).toBe('none');
  });
});

describe('objectHotspot.createObjectMarker — markers manipulable while drafting', () => {
  /** Rank-0 marker, projected on screen (it only exists in the DOM once rendered). */
  function dot() {
    const { camera, root } = scene();
    const container = document.createElement('div');
    const marker = createObjectMarker(THREE, container);
    marker.update([{ point: new THREE.Vector3(0, 0, 0), objectSpace: true }], camera, root, 800, 600);
    return { marker, el: container.children[0] as HTMLElement };
  }

  it('stays inert as long as no manager is set (read-back)', () => {
    const { el } = dot();
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('role')).toBeNull();
  });

  it('when dragged, the marker resets its point; when clicked, it designates it', () => {
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

  it('a gesture on a marker does not reach the canvas (no orbit, no extra point)', () => {
    const { marker, el } = dot();
    marker.setInteractive({ onMove: vi.fn(), onSelect: vi.fn(), label: () => 'Point 1' });
    const seen = vi.fn();
    el.parentElement!.addEventListener('pointerdown', seen);
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('the highlighted rank changes skin, and disarming restores inertness', () => {
    const { marker, el } = dot();
    marker.setInteractive({ onMove: vi.fn(), onSelect: vi.fn(), label: () => 'Point 1' });
    marker.setActive(0);
    expect(el.className).toContain('bg-background');
    marker.setInteractive(null);
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('aria-label')).toBeNull();
  });
});
