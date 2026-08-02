// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { appendBookmark, removeBookmarkAt, MAX_BOOKMARKS } from './cameraBookmarks';
import type { CameraBookmark, SplatCamera } from '../reviewTypes';

const cam = (x: number): SplatCamera => ({ position: { x, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });

describe('cameraBookmarks — logique pure (39.D)', () => {
  it('ajoute la vue avec un libellé auto-numéroté', () => {
    const out = appendBookmark([], cam(1));
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual({ camera: cam(1), label: 'Vue 1' });
    const out2 = appendBookmark(out!, cam(2));
    expect(out2![1].label).toBe('Vue 2');
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
