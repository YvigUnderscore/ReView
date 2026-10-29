// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Group } from '../chrome/DockGroup';
import { isLongDockGroup } from '../chrome/dockGroupSize';
import { Lightbox, type LightboxImage } from '../../../components/ui/lightbox';
import { drawTexturePreview, textureFullUrl } from '../three/textureImage';
import type { TextureInfo } from '../three/modelStats';
import { useT } from '../../../i18n';

/**
 * Texture inspector of the technical sheet (Phase 39, 39.C): one preview per glTF channel, the
 * carrying material and the dimensions. It is the only view of the review that distinguishes "the
 * model is dull" from "the base colour is 64×64" or "the normal map is a colour". The rest of the
 * dock only counts materials.
 *
 * The preview was capped at 48×48 and not clickable: one could therefore NOT judge a texture, only
 * notice that there was one. Each thumbnail now opens the repository's lightbox (the one used by the
 * attachments carousel), at the file's resolution, with zoom and navigation from one texture to the next.
 */

/** Side of the thumbnail, in canvas pixels: the CSS class gives it the same size in rem. */
const PREVIEW_PX = 48;

/** 48×48 preview of a texture (glTF image or procedural DataTexture) drawn on a canvas. */
function TexturePreview({ texture }: { texture: THREE.Texture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawTexturePreview(ref.current, texture);
  }, [texture]);
  return (
    <canvas
      ref={ref}
      width={PREVIEW_PX}
      height={PREVIEW_PX}
      className="h-12 w-12 shrink-0 rounded border border-border bg-secondary/40"
    />
  );
}

export default function TexturesGroup({ textures }: { textures: TextureInfo[] }) {
  const t = useT();
  const [openAt, setOpenAt] = useState<number | null>(null);

  /**
   * Full-resolution addresses, computed once per batch of textures: the lightbox is a carousel and
   * needs the whole list from the first opening. A texture the browser refuses to export (tainted
   * canvas) falls back to `null`: its thumbnail stays, but it does not open, rather than opening a
   * black frame.
   */
  const urls = useMemo(() => textures.map((tex) => textureFullUrl(tex.texture)), [textures]);
  const images = useMemo<LightboxImage[]>(
    () => textures.map((tex, i) => ({ src: urls[i] ?? '', alt: `${tex.slot} — ${tex.material}` })),
    [textures, urls],
  );

  return (
    <Group
      title={t('model3d.textures')}
      collapsible
      defaultCollapsed={isLongDockGroup(textures.length)}
      count={textures.length}
    >
      <ul className="flex flex-col gap-2">
        {textures.map((tex, i) => {
          const openable = Boolean(urls[i]);
          return (
            <li key={`${tex.material}-${tex.slot}-${i}`} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                disabled={!openable}
                title={openable ? t('model3d.texture.open') : t('model3d.texture.notOpenable')}
                onClick={() => setOpenAt(i)}
                className="rounded transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-100"
              >
                <TexturePreview texture={tex.texture} />
              </button>
              <div className="min-w-0">
                {/* The channel name stays that of the glTF: it is the one the artist reads back in their DCC. */}
                <p className="truncate font-medium">{tex.slot}</p>
                <p className="truncate text-muted-foreground">{tex.material}</p>
                <p className="font-mono text-muted-foreground">
                  {tex.width}×{tex.height}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {openAt !== null && (
        <Lightbox
          images={images}
          index={openAt}
          open
          onOpenChange={(open) => {
            if (!open) setOpenAt(null);
          }}
          onIndexChange={setOpenAt}
        />
      )}
    </Group>
  );
}
