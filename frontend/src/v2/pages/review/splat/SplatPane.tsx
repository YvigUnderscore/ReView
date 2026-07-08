import { type ReactNode, type RefObject } from 'react';
import { VIEWER_ZONE } from '../reviewTypes';

/**
 * Pane Gaussian Splat de la review (viewer Spark/SparkJS) — 10.G.
 * Le hook `useSplat` monte la scène Three.js dans `containerRef` ; ce composant gère le
 * cadre, les états de repli (chargement, échec) et l'overlay d'annotation 2D superposé.
 */
export default function SplatPane({
  containerRef,
  ready,
  loadError,
  status,
  overlay,
  editorOverlay,
  hud,
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
}) {
  return (
    <div className={VIEWER_ZONE}>
      {/* Conteneur de la scène Three.js (rempli par useSplat) — toujours monté */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Overlay d'édition (sélection rectangle/lasso) — au-dessus du canvas, sous les états */}
      {editorOverlay}

      {/* HUD flottant (au-dessus des overlays, sous les états de repli) */}
      {hud}

      {loadError ? (
        <div className="max-w-sm space-y-2 p-6 text-center text-sm text-muted-foreground">
          <p>
            Splat non affichable : le fichier n’a pas pu être chargé. Vérifiez le format (.ply, .spz, .splat,
            .ksplat, .sog) ou ré-uploadez le média.
          </p>
        </div>
      ) : status === 'PROCESSING' || !ready ? (
        <div className="text-center text-sm text-muted-foreground">Chargement du splat…</div>
      ) : null}

      {/* Overlay de dessin 2D superposé (s'aligne sur la vue caméra courante) */}
      {overlay && <div className="absolute inset-0 pointer-events-none">{overlay}</div>}
    </div>
  );
}
