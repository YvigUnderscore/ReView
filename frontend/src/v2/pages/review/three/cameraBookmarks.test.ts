// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { appendBookmark, bookmarkShortcutIndex, removeBookmarkAt, MAX_BOOKMARKS } from './cameraBookmarks';
import type { CameraBookmark, SplatCamera } from '../reviewTypes';

const cam = (x: number): SplatCamera => ({ position: { x, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });

/** Minimal keystroke, as read by `bookmarkShortcutIndex`. */
const key = (code: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('cameraBookmarks — pure logic (39.D)', () => {
  it('adds the view with an auto-numbered label', () => {
    const out = appendBookmark([], cam(1));
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual({ camera: cam(1), label: 'View 1' });
    const out2 = appendBookmark(out!, cam(2));
    expect(out2![1].label).toBe('View 2');
  });

  it('does not mutate the source list (immutability)', () => {
    const src: CameraBookmark[] = [];
    appendBookmark(src, cam(1));
    expect(src).toHaveLength(0);
  });

  it('returns null when the list is full', () => {
    const full: CameraBookmark[] = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({ camera: cam(i) }));
    expect(appendBookmark(full, cam(99))).toBeNull();
  });

  it('removes the bookmark at the given index', () => {
    const list: CameraBookmark[] = [{ camera: cam(0) }, { camera: cam(1) }, { camera: cam(2) }];
    expect(removeBookmarkAt(list, 1)).toEqual([{ camera: cam(0) }, { camera: cam(2) }]);
  });

  it('leaves the list unchanged out of bounds', () => {
    const list: CameraBookmark[] = [{ camera: cam(0) }];
    expect(removeBookmarkAt(list, 5)).toBe(list);
    expect(removeBookmarkAt(list, -1)).toBe(list);
  });
});

describe('bookmarkShortcutIndex — Alt + digit, without collision with the mode switch', () => {
  it('recalls the view of the digit under Alt', () => {
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 3)).toBe(0);
    expect(bookmarkShortcutIndex(key('Digit3', { altKey: true }), 3)).toBe(2);
    expect(bookmarkShortcutIndex(key('Numpad2', { altKey: true }), 3)).toBe(1);
  });

  it('ignores the bare digit: it belongs to the mode switch', () => {
    expect(bookmarkShortcutIndex(key('Digit2'), 3)).toBeNull();
  });

  it('ignores other modifiers', () => {
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true, ctrlKey: true }), 3)).toBeNull();
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true, metaKey: true }), 3)).toBeNull();
  });

  it('ignores a key with no view recorded opposite it', () => {
    expect(bookmarkShortcutIndex(key('Digit4', { altKey: true }), 3)).toBeNull();
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 0)).toBeNull();
  });

  it('ignores zero and non-numeric keys', () => {
    expect(bookmarkShortcutIndex(key('Digit0', { altKey: true }), 9)).toBeNull();
    expect(bookmarkShortcutIndex(key('KeyA', { altKey: true }), 9)).toBeNull();
  });

  it('reads the key position, not the character produced (AZERTY, macOS)', () => {
    // Alt+& on AZERTY, Alt+1 on a US keyboard: same position, same view.
    expect(bookmarkShortcutIndex(key('Digit1', { altKey: true }), 9)).toBe(0);
  });
});
