// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { Group } from '../chrome/DockGroup';
import type { TextureInfo } from '../three/modelStats';
import { useT } from '../../../i18n';

/**
 * Inspecteur de textures de la fiche technique (Phase 39, 39.C) : un aperçu par canal glTF,
 * le matériau porteur et les dimensions. C'est la seule vue de la review qui distingue
 * « le modèle est terne » de « la base colour fait 64×64 » ou « la normal map est une
 * couleur » — le reste du dock ne compte que les matériaux.
 */

/** Aperçu 48×48 d'une texture (image glTF ou DataTexture procédurale) dessiné sur canvas. */
function TexturePreview({ texture }: { texture: THREE.Texture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current;
    const ctx = cvs?.getContext('2d');
    if (!cvs || !ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    const img = texture.image as CanvasImageSource & {
      data?: ArrayLike<number>;
      width?: number;
      height?: number;
    };
    try {
      const isDrawable =
        (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
        (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
      if (isDrawable) {
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
      } else if (img?.data && img.width && img.height) {
        // DataTexture : blit via un canvas intermédiaire à la résolution native puis mise à l'échelle.
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tctx = tmp.getContext('2d');
        if (tctx) {
          const arr = new Uint8ClampedArray(img.data);
          if (arr.length >= img.width * img.height * 4) {
            tctx.putImageData(new ImageData(arr, img.width, img.height), 0, 0);
            ctx.drawImage(tmp, 0, 0, cvs.width, cvs.height);
          }
        }
      }
    } catch {
      /* aperçu indisponible (texture non lisible en 2D) — le cadre vide reste affiché */
    }
  }, [texture]);
  return (
    <canvas
      ref={ref}
      width={48}
      height={48}
      className="h-12 w-12 shrink-0 rounded border border-border bg-secondary/40"
    />
  );
}

export default function TexturesGroup({ textures }: { textures: TextureInfo[] }) {
  const t = useT();
  return (
    <Group title={t('model3d.textures')} action={<span className="font-mono">{textures.length}</span>}>
      <ul className="flex flex-col gap-2">
        {textures.map((tex, i) => (
          <li key={`${tex.material}-${tex.slot}-${i}`} className="flex items-center gap-2 text-xs">
            <TexturePreview texture={tex.texture} />
            <div className="min-w-0">
              {/* Le nom du canal reste celui du glTF : c'est celui que l'artiste relit dans son DCC. */}
              <p className="truncate font-medium">{tex.slot}</p>
              <p className="truncate text-muted-foreground">{tex.material}</p>
              <p className="font-mono text-muted-foreground">
                {tex.width}×{tex.height}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Group>
  );
}
