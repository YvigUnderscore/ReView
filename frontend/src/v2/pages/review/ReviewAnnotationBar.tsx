// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { EyeOff } from 'lucide-react';
import type { useAnnotations } from './useAnnotations';
import { useT } from '../../i18n';

/**
 * Pilule flottante « Masquer l'annotation », affichée **sur le viewer** (haut, centrée)
 * quand l'annotation d'un commentaire est visible — accessible sans quitter l'image des
 * yeux, fermable aussi avec Échap. Les outils de dessin vivent sous le champ de
 * commentaire ; depuis la refonte du chrome, ils vivent dans le rail et la barre d'options.
 */
export default function ReviewAnnotationBar({
  ann,
  onClearSelection,
}: {
  ann: ReturnType<typeof useAnnotations>;
  onClearSelection: () => void;
}) {
  const t = useT();
  const visible = !!ann.viewed;
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
    <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
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
