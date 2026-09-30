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
 * Inspecteur de textures de la fiche technique (Phase 39, 39.C) : un aperçu par canal glTF,
 * le matériau porteur et les dimensions. C'est la seule vue de la review qui distingue
 * « le modèle est terne » de « la base colour fait 64×64 » ou « la normal map est une
 * couleur » — le reste du dock ne compte que les matériaux.
 *
 * L'aperçu était plafonné à 48×48 et n'était pas cliquable : on ne pouvait donc PAS juger une
 * texture, seulement constater qu'il y en avait une. Chaque vignette ouvre désormais la
 * lightbox du dépôt (celle du carrousel des pièces jointes), à la résolution du fichier, avec
 * zoom et navigation d'une texture à l'autre.
 */

/** Côté de la vignette, en pixels de canvas — la classe CSS lui donne la même taille en rem. */
const PREVIEW_PX = 48;

/** Aperçu 48×48 d'une texture (image glTF ou DataTexture procédurale) dessiné sur canvas. */
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
   * Adresses pleine résolution, calculées une fois par lot de textures : la lightbox est un
   * carrousel, elle a besoin de toute la liste dès la première ouverture. Une texture que le
   * navigateur refuse d'exporter (canvas marqué) tombe à `null` — sa vignette reste, mais
   * elle ne s'ouvre pas, plutôt que d'ouvrir un cadre noir.
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
                {/* Le nom du canal reste celui du glTF : c'est celui que l'artiste relit dans son DCC. */}
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
