// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { EyeOff } from 'lucide-react';
import type { useAnnotations } from './useAnnotations';
import { useT } from '../../i18n';

/**
 * Emplacements de la pilule. Ancrée `viewer`, elle vit **dans la zone média** (en bas,
 * centrée) : c'est le seul bord qu'aucune surface du viewer n'occupe déjà — les bandeaux
 * d'état (placement d'un point, scène proposée par un commentaire) tiennent le haut centré,
 * les menus de rendu le coin haut-gauche, les repères de zoom le bas-droit. Elle y est aussi
 * au plus près du fil de commentaires, d'où l'on vient et où l'on retourne écrire.
 *
 * `page` est l'ancien ancrage, relatif au bloc qui enveloppe le viewer : il reste celui du
 * lecteur vidéo et du partage client, dont la zone média n'accueille pas encore la pilule.
 */
const ANCHOR = {
  viewer: 'bottom-3 left-1/2 -translate-x-1/2',
  page: 'left-1/2 top-2 -translate-x-1/2',
} as const;

/**
 * Pilule flottante « Masquer l'annotation », affichée quand l'annotation d'un commentaire
 * est visible — accessible sans quitter l'image des yeux, fermable aussi avec Échap. Les
 * outils de dessin vivent sous le champ de commentaire ; depuis la refonte du chrome, ils
 * vivent dans le rail et la barre d'options.
 *
 * Elle se posait dans la section de review, dont le premier enfant est l'en-tête unifié du
 * chrome : la pilule tombait donc **sur la bascule de mode** (centrée, elle aussi) ou sur la
 * bande de consigne. D'où l'ancrage : dans le viewer, au même endroit pour l'image, le
 * modèle 3D et le nuage de points.
 */
export default function ReviewAnnotationBar({
  ann,
  onClearSelection,
  anchor = 'page',
}: {
  ann: ReturnType<typeof useAnnotations>;
  onClearSelection: () => void;
  /** Conteneur qui porte la pilule — `viewer` dès que la zone média la reçoit. */
  anchor?: keyof typeof ANCHOR;
}) {
  const t = useT();
  // Les points d'intérêt comptent autant que le dessin : depuis qu'ils survivent à un mouvement
  // de vue (ils sont ancrés dans la scène), ils sont même ce qui reste le plus longtemps à
  // l'écran — sans eux dans cette condition, la lecture d'un commentaire n'aurait plus de sortie.
  const visible = !!ann.viewed || ann.viewedPoi.length > 0;
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClearSelection]);

  if (!visible) return null;
  return (
    <div className={`pointer-events-none absolute z-30 ${ANCHOR[anchor]}`}>
      <button
        onClick={onClearSelection}
        title={t('review.annotation.hide')}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-sm shadow-lg backdrop-blur hover:bg-secondary"
      >
        <EyeOff size={14} /> {t('ctx.hideAnnotation')}
      </button>
    </div>
  );
}
