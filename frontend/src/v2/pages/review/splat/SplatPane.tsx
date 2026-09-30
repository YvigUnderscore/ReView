// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode, type RefObject } from 'react';
import { VIEWER_ZONE } from '../reviewTypes';
import ReviewFrame from '../ReviewFrame';
import { useT } from '../../../i18n';

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
  progress,
  status,
  overlay,
  editorOverlay,
  pip,
  settings,
  aspect,
  recording,
  notice,
  exit,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Progression du téléchargement réseau (0..1) ou null (décodage/LOD en cours) — 41.B. */
  progress: number | null;
  status: string;
  overlay: ReactNode;
  /** Overlay interactif de l'éditeur (tracé de sélection) — capte le pointeur, contrairement à `overlay`. */
  editorOverlay?: ReactNode;
  /** Fenêtre PiP du mode layout (PipFrame — le rendu WebGL est dessiné dessous en scissor). */
  pip?: ReactNode;
  /**
   * Menus du viewer, posés en HAUT À GAUCHE (Phase 50, lot 12) : édition du nuage et réglages
   * de rendu, au même coin et dans le même langage que ceux du modèle 3D (lot 6). Absent du
   * partage client, qui ne règle rien.
   */
  settings?: ReactNode;
  /** Aspect du cadre de review fixe (issu de la caméra de présentation) — défaut 16:9 (V6). */
  aspect?: number;
  /** Auto-key armé : liseré d'enregistrement sur le viewport (façon DCC). */
  recording?: boolean;
  /** Bandeau d'état posé au-dessus du nuage (placement d'un point d'intérêt) — jumeau du 3D. */
  notice?: ReactNode;
  /**
   * Sortie de la lecture d'un commentaire annoté, en BAS du viewer — même bord et même pilule
   * que le modèle 3D et l'image ; le haut centré appartient au bandeau d'état.
   */
  exit?: ReactNode;
}) {
  const t = useT();
  return (
    <div className={VIEWER_ZONE} data-viewer-zone>
      {recording && (
        <div className="pointer-events-none absolute inset-0 z-20 ring-2 ring-destructive/70 ring-inset" />
      )}
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

        {pip}
      </ReviewFrame>

      {notice}
      {exit}

      {/* Au-dessus du cadre, jamais dedans : le guide letterbox et l'overlay d'annotation
          gardent leurs coordonnées — ce coin ne touche pas au cadrage. */}
      {settings && <div className="absolute top-2 left-2 z-20">{settings}</div>}

      {/* États de repli — centrés dans toute la zone (hors letterbox) */}
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t('splat.unviewable')}</p>
        </div>
      ) : status === 'PROCESSING' || !ready ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {/* 41.B : barre de progression réelle pendant le téléchargement (grosses scènes) ;
              une fois le fichier reçu (progress null), on bascule sur le décodage indéterminé. */}
          {typeof progress === 'number' && progress < 1 ? (
            <>
              <span className="text-sm text-muted-foreground">
                {t('splat.downloading', { pct: Math.round(progress * 100) })}
              </span>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t('review.splat.loading')}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
