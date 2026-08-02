// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode, type RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { VIEWER_ZONE } from './reviewTypes';
import ReviewFrame from './ReviewFrame';
import { useT } from '../../i18n';

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
  aspect,
  pip,
  notice,
  canReprocess,
  reprocessing,
  processingError,
  onReprocess,
}: {
  status: string;
  loadError: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  overlay: ReactNode;
  /** Aspect du cadre de review fixe (issu de la présentation persistée) — défaut 16:9. */
  aspect?: number;
  /** Fenêtre PiP du mode layout (PipFrame — le rendu WebGL est dessiné dessous en scissor). */
  pip?: ReactNode;
  /** Bandeau flottant en haut du viewer (46.T : retour à la scène par défaut). */
  notice?: ReactNode;
  canReprocess: boolean;
  reprocessing: boolean;
  /** Raison de l'échec de traitement remontée par le worker (45.C), null si inconnue. */
  processingError?: string | null;
  onReprocess: () => void;
}) {
  const t = useT();
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
        {pip}
      </ReviewFrame>
      {notice}

      {status === 'PROCESSING' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('review.converting')}</span>
        </div>
      ) : showError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center text-sm text-muted-foreground">
            <p>{t('model3d.unviewable')}</p>
            {/* Raison remontée par le worker (45.C) : asset USD manquant, outillage absent,
                archive refusée… — sans elle, l'utilisateur ne sait pas quoi corriger. */}
            {processingError && (
              <p className="rounded border border-border bg-card/60 px-2 py-1.5 text-left font-mono text-[11px] break-words text-foreground">
                {processingError}
              </p>
            )}
            {canReprocess && (
              <button
                onClick={onReprocess}
                disabled={reprocessing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <RotateCcw size={13} /> {reprocessing ? 'Relance…' : t('model3d.reconvert')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
