// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_MAX_WIDTH,
  CAPTURE_MIN_WIDTH,
  EXCLUDE_FROM_CAPTURE,
  captureSize,
  hideCaptureMarkers,
  renderViewCapture,
  type CaptureObject,
  type CaptureSize,
} from './viewCapture';

/** Scène minimale : `traverse` est tout ce que la capture demande d'une scène Three. */
const sceneOf = (objects: CaptureObject[]) => ({
  traverse: (visit: (o: CaptureObject) => void) => objects.forEach(visit),
});

const marker = (visible = true): CaptureObject => ({
  visible,
  userData: { [EXCLUDE_FROM_CAPTURE]: true },
});

describe('captureSize — la capture sort à la résolution de livraison, pas à celle de la fenêtre', () => {
  it('suréchantillonne quand le cadre à l’écran est plus petit que la largeur visée', () => {
    expect(captureSize(999, 16 / 9)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
  });

  it('garde la résolution native quand le rendu est déjà plus large', () => {
    expect(captureSize(2844, 16 / 9)).toEqual({ width: 2844, height: 1600 });
  });

  it('respecte le plafond du GPU, et le plafond de sûreté au-delà', () => {
    expect(captureSize(999, 16 / 9, 1024)).toEqual({ width: 1024, height: 576 });
    expect(captureSize(9000, 16 / 9, 99999).width).toBe(CAPTURE_MAX_WIDTH);
  });

  it('format très haut : c’est la hauteur qui touche le plafond', () => {
    const size = captureSize(400, 0.25);
    expect(size.height).toBe(CAPTURE_MAX_WIDTH);
    expect(size.width).toBe(1024);
  });

  it('aspect aberrant : repli sur 16:9 plutôt qu’une image de hauteur nulle', () => {
    expect(captureSize(1920, 0)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
    expect(captureSize(1920, Number.NaN)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
  });
});

describe('hideCaptureMarkers — les repères d’écran sortent de la capture, puis reviennent', () => {
  it('masque les seuls objets marqués et les remet tels qu’ils étaient', () => {
    const grid = marker();
    const model: CaptureObject = { visible: true };
    const show = hideCaptureMarkers(sceneOf([grid, model]));
    expect(grid.visible).toBe(false);
    expect(model.visible).toBe(true);
    show();
    expect(grid.visible).toBe(true);
  });

  it('laisse invisible un repère déjà éteint (l’utilisateur avait coupé la grille)', () => {
    const grid = marker(false);
    const show = hideCaptureMarkers(sceneOf([grid]));
    show();
    expect(grid.visible).toBe(false);
  });
});

/** Dépendances de capture : un rendu qui note la taille reçue, un encodage, une remise en place. */
function deps(opts: { renderAt?: (s: CaptureSize) => void; encode?: () => string | null } = {}) {
  const grid = marker();
  const sizes: CaptureSize[] = [];
  const restore = vi.fn();
  return {
    grid,
    sizes,
    restore,
    call: () =>
      renderViewCapture({
        buffer: { width: 1000, height: 562 },
        scene: sceneOf([grid]),
        aspect: 16 / 9,
        renderAt: (s) => {
          sizes.push(s);
          opts.renderAt?.(s);
        },
        encode: opts.encode ?? (() => 'data:image/png;base64,zzz'),
        restore,
      }),
  };
}

describe('renderViewCapture', () => {
  it('rend à la résolution voulue et renvoie l’image encodée', () => {
    const d = deps();
    expect(d.call()).toBe('data:image/png;base64,zzz');
    expect(d.sizes).toEqual([{ width: CAPTURE_MIN_WIDTH, height: 1080 }]);
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });

  it('un rendu qui échoue ne laisse ni la scène sans sa grille ni le viewer hors taille', () => {
    const d = deps({
      renderAt: () => {
        throw new Error('drawing buffer');
      },
    });
    expect(d.call()).toBeNull();
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });

  it('un encodage qui échoue (canvas « tainted ») se solde de la même façon', () => {
    const d = deps({
      encode: () => {
        throw new Error('tainted');
      },
    });
    expect(d.call()).toBeNull();
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });
});
