import { type ReactNode, type RefObject } from 'react';
import { VIEWER_ZONE } from '../reviewTypes';
import ReviewFrame from '../ReviewFrame';

/**
 * Pane Gaussian Splat de la review (viewer Spark/SparkJS) — 10.G.
 * Le hook `useSplat` monte la scène Three.js dans `containerRef` ; ce composant gère le
 * cadre de review à aspect fixe (V6 — canvas letterboxé, non étiré à l'écran), les états de
 * repli (chargement, échec) et l'overlay d'annotation 2D superposé.
 */
export default function SplatPane({
  containerRef,
  ready,
  loadError,
  status,
  overlay,
  editorOverlay,
  hud,
  pip,
  aspect,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  status: string;
  overlay: ReactNode;
  /** Overlay interactif de l'éditeur (tracé de sélection) — capte le pointeur, contrairement à `overlay`. */
  editorOverlay?: ReactNode;
  /** HUD flottant superposé au canvas (toolbars, stats, réglages) — cf. hud/ViewerHud. */
  hud?: ReactNode;
  /** Fenêtre PiP du mode layout (PipFrame — le rendu WebGL est dessiné dessous en scissor). */
  pip?: ReactNode;
  /** Aspect du cadre de review fixe (issu de la caméra de présentation) — défaut 16:9 (V6). */
  aspect?: number;
}) {
  return (
    <div className={VIEWER_ZONE} data-viewer-zone>
      {/* Viewer plein espace + guide letterbox du cadre de livraison (Phase 25) ; l'overlay
          d'annotation 2D est ancré au guide, la sélection éditeur reste plein cadre. */}
      <ReviewFrame
        aspect={aspect}
        frame={overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      >
        {/* Conteneur de la scène Three.js (rempli par useSplat) — toujours monté */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Overlay d'édition (sélection rectangle/lasso) — au-dessus du canvas, sous les états */}
        {editorOverlay}

        {/* HUD flottant (au-dessus des overlays, sous les états de repli) */}
        {hud}
        {pip}
      </ReviewFrame>

      {/* États de repli — centrés dans toute la zone (hors letterbox) */}
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Splat non affichable : le fichier n’a pas pu être chargé. Vérifiez le format (.ply, .spz, .splat,
            .ksplat, .sog) ou ré-uploadez le média.
          </p>
        </div>
      ) : status === 'PROCESSING' || !ready ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">Chargement du splat…</span>
        </div>
      ) : null}
    </div>
  );
}
