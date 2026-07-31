import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type * as THREE from 'three';
import type { ModelStats, TextureInfo } from './three/modelStats';
import type { ModelSource } from '../../types/api';
import ModelUsdSection from './ModelUsdSection';

const fmt = (n: number) => n.toLocaleString('fr-FR');

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
        ctx.drawImage(img as CanvasImageSource, 0, 0, cvs.width, cvs.height);
      } else if (img?.data && img.width && img.height) {
        // DataTexture : blit via un canvas intermédiaire à la résolution native puis mise à l'échelle.
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tctx = tmp.getContext('2d');
        if (tctx) {
          const arr = new Uint8ClampedArray(img.data as ArrayLike<number>);
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
    <canvas ref={ref} width={48} height={48} className="h-12 w-12 shrink-0 rounded border border-border" />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/** Libellé lisible du convertisseur ayant produit le GLB affiché. */
const CONVERTER_LABEL: Record<string, string> = {
  blender: 'USD (Blender)',
  usd: 'USD natif',
  assimp: 'assimp',
  gltf: 'glTF (packé)',
  copy: 'glTF (direct)',
};

/**
 * Fiche technique du modèle 3D (Phase 39, 39.C) : géométrie (meshes/triangles/sommets), matériaux,
 * jeux d'UV, extensions glTF, et **inspecteur de textures** (aperçu par canal + dimensions). Panneau
 * flottant en lecture seule, superposé au viewer (zone haut-droite du HUD).
 */
export default function ModelInfoPanel({
  stats,
  extensions,
  source,
  onRecompose,
  onClose,
}: {
  stats: ModelStats | null;
  extensions: string[];
  /** Provenance de conversion (39.A) : format source + convertisseur, null si inconnue. */
  source?: ModelSource | null;
  /** Ouvre la recomposition USD (45.F) — absent si le média est publié ou en lecture seule. */
  onRecompose?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto w-72 max-w-[80vw] rounded-md border border-border bg-card/95 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-medium text-foreground">Fiche technique</span>
        <button onClick={onClose} title="Fermer" className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      {!stats ? (
        <p className="px-3 py-3 text-muted-foreground">Chargement du modèle…</p>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-3 py-3">
          {source && (
            <section className="space-y-1">
              <Row label="Format source" value={source.sourceFormat} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Conversion</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-right font-medium text-foreground">
                    {CONVERTER_LABEL[source.converter] ?? source.converter}
                  </span>
                  {source.native && (
                    <span
                      title="Matériaux UsdPreviewSurface & variantes préservés"
                      className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                    >
                      natif
                    </span>
                  )}
                </span>
              </div>
              {source.usd && <ModelUsdSection usd={source.usd} onRecompose={onRecompose} />}
            </section>
          )}

          <section className="space-y-1">
            <Row label="Meshes" value={fmt(stats.meshes)} />
            <Row label="Triangles" value={fmt(stats.triangles)} />
            <Row label="Sommets" value={fmt(stats.vertices)} />
            <Row label="Jeux d'UV" value={stats.uvSets.length ? stats.uvSets.join(', ') : 'aucun'} />
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Matériaux ({stats.materials.length})</p>
            {stats.materials.length === 0 ? (
              <p className="text-muted-foreground">aucun</p>
            ) : (
              <ul className="space-y-0.5">
                {stats.materials.map((m, i) => (
                  <li key={`${m.name}-${i}`} className="flex justify-between gap-3">
                    <span className="truncate text-foreground">{m.name}</span>
                    <span className="shrink-0 text-muted-foreground">{m.type.replace('Material', '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Extensions glTF</p>
            {extensions.length === 0 ? (
              <p className="text-muted-foreground">aucune</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {extensions.map((e) => (
                  <span
                    key={e}
                    className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                  >
                    {e}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Textures ({stats.textures.length})</p>
            {stats.textures.length === 0 ? (
              <p className="text-muted-foreground">aucune</p>
            ) : (
              <ul className="space-y-2">
                {stats.textures.map((t: TextureInfo, i) => (
                  <li key={`${t.material}-${t.slot}-${i}`} className="flex items-center gap-2">
                    <TexturePreview texture={t.texture} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{t.slot}</p>
                      <p className="truncate text-muted-foreground">{t.material}</p>
                      <p className="text-muted-foreground">
                        {t.width}×{t.height}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
