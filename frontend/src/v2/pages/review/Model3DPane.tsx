import { createElement, type ReactNode, type RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { VIEWER_ZONE, type Hotspot3D, type Transform } from './reviewTypes';
import ReviewFrame from './ReviewFrame';

/**
 * Encapsule le web component <model-viewer>.
 * - interpolation-decay : transition caméra fluide (~1 s) lors d'une restauration de vue.
 * - freeCamera : mode « libre » (non recentré sur l'asset). model-viewer reste orbital
 *   pour la rotation, mais le PANNING translate la cible/caméra librement dans l'espace.
 *   On déverrouille l'orbite + la focale et on désactive le recentrage (disable-tap),
 *   pour ne plus être contraint d'orbiter autour du centre du modèle.
 */
function ModelViewer({
  src,
  innerRef,
  transform,
  hotspots,
  freeCamera,
  animationName,
}: {
  src: string;
  innerRef: RefObject<HTMLElement | null>;
  transform: Transform;
  hotspots: Hotspot3D[];
  freeCamera: boolean;
  animationName?: string;
}) {
  const markers = hotspots.map((h, i) =>
    createElement(
      'button',
      {
        key: i,
        slot: `hotspot-${i}`,
        className: 'mv-hotspot',
        'data-position': h.position,
        'data-normal': h.normal,
      },
      String(i + 1),
    ),
  );
  return createElement(
    'model-viewer',
    {
      ref: innerRef,
      src,
      'camera-controls': true,
      'touch-action': 'pan-y',
      'environment-image': 'neutral',
      exposure: '1',
      'shadow-intensity': '1',
      'interaction-prompt': 'none',
      'interpolation-decay': '200',
      ...(animationName ? { 'animation-name': animationName } : {}),
      ...(freeCamera
        ? {
            // Orbite et focale déverrouillées + pas de recentrage : déplacement libre par panning.
            'min-camera-orbit': 'auto 0deg 0m',
            'max-camera-orbit': 'auto 180deg Infinity',
            'min-field-of-view': '5deg',
            'max-field-of-view': '120deg',
            'disable-tap': true,
          }
        : {}),
      orientation: `${transform.roll}deg ${transform.pitch}deg ${transform.yaw}deg`,
      scale: `${transform.scale} ${transform.scale} ${transform.scale}`,
      style: {
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent',
        '--poster-color': 'transparent',
      },
    },
    ...markers,
  );
}

/**
 * Pane 3D de la review : viewer GLB + overlay d'annotation 2D, états de repli
 * (conversion en cours, conversion échouée avec relance).
 */
export default function Model3DPane({
  status,
  ready,
  glbSrc,
  modelRef,
  transform,
  freeCamera,
  hotspots,
  animationName,
  overlay,
  canReprocess,
  reprocessing,
  onReprocess,
}: {
  status: string;
  ready: boolean;
  glbSrc: string | null;
  modelRef: RefObject<HTMLElement | null>;
  transform: Transform;
  freeCamera: boolean;
  hotspots: Hotspot3D[];
  animationName?: string;
  overlay: ReactNode;
  canReprocess: boolean;
  reprocessing: boolean;
  onReprocess: () => void;
}) {
  return (
    <div className={VIEWER_ZONE}>
      {status === 'PROCESSING' ? (
        <div className="text-center text-sm text-muted-foreground">
          Conversion 3D en cours… (rechargez dans un instant)
        </div>
      ) : ready && glbSrc ? (
        // Cadre de review à aspect fixe (V6) : le viewer et l'overlay rendent letterboxés,
        // non étirés à l'écran — annotations alignées quelle que soit la taille de fenêtre.
        <ReviewFrame>
          <ModelViewer
            src={glbSrc}
            innerRef={modelRef}
            transform={transform}
            freeCamera={freeCamera}
            hotspots={hotspots}
            animationName={animationName}
          />
          {/* Overlay de dessin 2D superposé au modèle (s'aligne via la vue caméra) */}
          {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
        </ReviewFrame>
      ) : (
        <div className="max-w-sm space-y-3 p-6 text-center text-sm text-muted-foreground">
          <p>
            Modèle 3D non affichable : le fichier n’a pas pu être converti en GLB. Relancez la conversion, ou
            ré-uploadez un GLB/glTF.
          </p>
          {canReprocess && (
            <button
              onClick={onReprocess}
              disabled={reprocessing}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <RotateCcw size={13} /> {reprocessing ? 'Relance…' : 'Relancer la conversion'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
