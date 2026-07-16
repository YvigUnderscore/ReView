import { type ReactNode, type RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { VIEWER_ZONE } from './reviewTypes';
import ReviewFrame from './ReviewFrame';

/**
 * Pane 3D de la review (viewer **Three.js**) : le hook `useModel3DThree` monte la scène dans
 * `containerRef` (toujours présent). Cadre de review à aspect fixe (V6), overlay d'annotation 2D
 * superposé, états de repli (conversion en cours / échec avec relance). Remplace `Model3DPane`
 * (model-viewer).
 */
export default function Model3DThreePane({
  status,
  loadError,
  containerRef,
  overlay,
  hud,
  aspect,
  layoutMode,
  canReprocess,
  reprocessing,
  onReprocess,
}: {
  status: string;
  loadError: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  overlay: ReactNode;
  /** HUD flottant unifié (ViewerHud), superposé au canvas façon logiciel 3D (Phase 17). */
  hud?: ReactNode;
  /** Aspect du cadre de review fixe (issu de la présentation persistée) — défaut 16:9. */
  aspect?: number;
  /** Mode layout actif : encadre le PiP (rendu WebGL en coin bas-droit) d'un cadre « fenêtre ». */
  layoutMode: boolean;
  canReprocess: boolean;
  reprocessing: boolean;
  onReprocess: () => void;
}) {
  const showError = loadError || (status !== 'PROCESSING' && status !== 'READY');
  return (
    <div className={VIEWER_ZONE} data-viewer-zone>
      {/* Viewer plein espace + guide letterbox du cadre de livraison (Phase 25) ; l'overlay
          d'annotation est ancré au guide (coordonnées normalisées alignées pour tous). */}
      <ReviewFrame
        aspect={aspect}
        frame={overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      >
        {/* Conteneur de la scène Three.js (rempli par useModel3DThree) — toujours monté */}
        <div ref={containerRef} className="absolute inset-0" />
        {hud}
        {/* Cadre « fenêtre flottante » du PiP (le rendu WebGL est dessiné dessous en scissor) */}
        {layoutMode && (
          <div className="pointer-events-none absolute bottom-2.5 right-2.5 w-[28%] overflow-hidden rounded-md border border-primary/70 shadow-lg">
            <div className="aspect-video" />
            <span className="absolute left-1 top-1 rounded bg-primary/80 px-1 text-[10px] font-medium text-primary-foreground">
              Caméra layout
            </span>
          </div>
        )}
      </ReviewFrame>

      {status === 'PROCESSING' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">
            Conversion 3D en cours… (rechargez dans un instant)
          </span>
        </div>
      ) : showError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center text-sm text-muted-foreground">
            <p>
              Modèle 3D non affichable : le fichier n’a pas pu être converti en GLB. Relancez la conversion,
              ou ré-uploadez un GLB/glTF.
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
        </div>
      ) : null}
    </div>
  );
}
