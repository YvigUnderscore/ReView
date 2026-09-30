// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Ce qu'on peut faire d'une texture Three **hors de la scène** : une vignette dans le dock,
 * et une image plein écran dans la lightbox.
 *
 * Trois formes arrivent du chargeur glTF, et une seule est directement affichable en HTML :
 *   - `HTMLImageElement` — le cas courant, et le seul qui porte déjà une adresse (`blob:` pour
 *     une texture embarquée dans le GLB). On la sert telle quelle : aucun canvas, donc aucun
 *     risque de canvas « tainted », et la pleine résolution sans recopie ;
 *   - `ImageBitmap` / `HTMLCanvasElement` — dessinables, mais sans adresse : il faut passer par
 *     un canvas pour en tirer une image ;
 *   - `DataTexture` — un tableau d'octets (damier UV procédural, matcap) : même chose, via
 *     `ImageData`.
 *
 * La classification est séparée du dessin pour être testable sans contexte 2D : happy-dom
 * n'implémente pas `getContext('2d')`, et un test qui ne peut rien dessiner doit quand même
 * pouvoir vérifier qu'une texture d'image donne bien son adresse.
 */

/** Image sous-jacente d'une texture, ramenée à ce qui sait la rendre. */
export type TextureImageSource =
  | { kind: 'element'; image: CanvasImageSource; width: number; height: number; src: string }
  | { kind: 'drawable'; image: CanvasImageSource; width: number; height: number }
  | { kind: 'data'; data: ArrayLike<number>; width: number; height: number };

type RawImage = CanvasImageSource & {
  data?: ArrayLike<number>;
  width?: number;
  height?: number;
  src?: string;
};

/** Classe l'image d'une texture, ou `null` si rien n'est exploitable hors WebGL. */
export function textureImageSource(texture: THREE.Texture): TextureImageSource | null {
  const img = texture.image as RawImage | null | undefined;
  if (!img) return null;
  const width = img.width ?? 0;
  const height = img.height ?? 0;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement)
    // `naturalWidth` plutôt que `width` : une `<img>` non attachée au document rapporte 0 en
    // `width` tant qu'elle n'est pas mise en page, alors que le pixel est bien là.
    return img.src
      ? {
          kind: 'element',
          image: img,
          width: img.naturalWidth || width,
          height: img.naturalHeight || height,
          src: img.src,
        }
      : null;
  const drawable =
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
  if (drawable) return { kind: 'drawable', image: img, width, height };
  if (img.data && width && height) return { kind: 'data', data: img.data, width, height };
  return null;
}

/** Canvas à la résolution native, rempli avec la source — `null` si le dessin est impossible. */
function paint(source: TextureImageSource): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !source.width || !source.height) return null;
  if (source.kind === 'data') {
    const arr = new Uint8ClampedArray(source.data);
    if (arr.length < source.width * source.height * 4) return null;
    ctx.putImageData(new ImageData(arr, source.width, source.height), 0, 0);
    return canvas;
  }
  ctx.drawImage(source.image, 0, 0, source.width, source.height);
  return canvas;
}

/**
 * Adresse affichable de la texture en pleine résolution (lightbox). Une image garde la sienne ;
 * tout le reste passe par un canvas, dont l'export peut échouer — contexte 2D absent (tests),
 * ou canvas marqué par une image servie sans en-tête CORS. Dans ce cas la texture n'est pas
 * ouvrable en grand, et l'appelant se contente de sa vignette.
 */
export function textureFullUrl(texture: THREE.Texture): string | null {
  const source = textureImageSource(texture);
  if (!source) return null;
  if (source.kind === 'element') return source.src;
  try {
    return paint(source)?.toDataURL() ?? null;
  } catch {
    return null;
  }
}

/** Dessine la vignette d'une texture dans un canvas déjà dimensionné. */
export function drawTexturePreview(canvas: HTMLCanvasElement, texture: THREE.Texture): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const source = textureImageSource(texture);
  if (!source) return;
  try {
    if (source.kind === 'data') {
      // Blit à la résolution native puis mise à l'échelle : `putImageData` ignore toute
      // transformation, il ne sait pas réduire.
      const native = paint(source);
      if (native) ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  } catch {
    /* aperçu indisponible (texture non lisible en 2D) — le cadre vide reste affiché */
  }
}
