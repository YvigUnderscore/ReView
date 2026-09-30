// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { appendBookmark, bookmarkShortcutIndex, removeBookmarkAt, MAX_BOOKMARKS } from './cameraBookmarks';
import type { CameraBookmark, SplatCamera } from '../reviewTypes';

const cam = (x: number): SplatCamera => ({ position: { x, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });

/** Frappe minimale, telle que la lit `bookmarkShortcutIndex`. */
const key = (code: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('cameraBookmarks — logique pure (39.D)', () => {
  it('ajoute la vue avec un libellé auto-numéroté', () => {
    const out = appendBookmark([], cam(1));
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual({ camera: cam(1), label: 'View 1' });
    const out2 = appendBookmark(out!, cam(2));
    expect(out2![1].label).toBe('View 2');
  });

  it('ne mute pas la liste source (immutabilité)', () => {
    const src: CameraBookmark[] = [];
    appendBookmark(src, cam(1));
    expect(src).toHaveLength(0);
  });

  it('renvoie null quand la liste est pleine', () => {
    const full: CameraBookmark[] = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({ camera: cam(i) }));
    expect(appendBookmark(full, cam(99))).toBeNull();
  });

  it('retire le bookmark à l’indice donné', () => {
    const list: CameraBookmark[] = [{ camera: cam(0) }, { camera: cam(1) }, { camera: cam(2) }];
    expect(removeBookmarkAt(list, 1)).toEqual([{ camera: cam(0) }, { camera: cam(2) }]);
  });

  it('laisse la liste inchangée hors bornes', () => {
    const list: CameraBookmark[] = [{ camera: cam(0) }];
    expect(removeBookmarkAt(list, 5)).toBe(list);
    expect(removeBookmarkAt(list, -1)).toBe(list);
  });
});

describe('bookmarkShortcutIndex — Alt + chiffre, sans collision avec la bascule de mode', () => {
  it('rappelle la vue du chiffre sous Alt', () => {
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 3)).toBe(0);
    expect(bookmarkShortcutIndex(key('Digit3', { altKey: true }), 3)).toBe(2);
    expect(bookmarkShortcutIndex(key('Numpad2', { altKey: true }), 3)).toBe(1);
  });

  it('ignore le chiffre nu — il appartient à la bascule de mode', () => {
    expect(bookmarkShortcutIndex(key('Digit2'), 3)).toBeNull();
  });

  it('ignore les autres modificateurs', () => {
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true, ctrlKey: true }), 3)).toBeNull();
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true, metaKey: true }), 3)).toBeNull();
  });

  it('ignore une touche sans vue enregistrée en face', () => {
    expect(bookmarkShortcutIndex(key('Digit4', { altKey: true }), 3)).toBeNull();
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 0)).toBeNull();
  });

  it('ignore le zéro et les touches non numériques', () => {
    expect(bookmarkShortcutIndex(key('Digit0', { altKey: true }), 9)).toBeNull();
    expect(bookmarkShortcutIndex(key('KeyA', { altKey: true }), 9)).toBeNull();
  });

  it('lit la position de la touche, pas le caractère produit (AZERTY, macOS)', () => {
    // Alt+& en AZERTY, Alt+1 sur un clavier US : même position, même vue.
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 9)).toBe(0);
  });
});
