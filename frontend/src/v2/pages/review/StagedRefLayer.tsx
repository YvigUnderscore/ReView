// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { onCanvasRefBox } from './referenceBox';
import { viewerCanvas } from './useViewerBands';
import type { Annotations } from './useAnnotations';
import { useT } from '../../i18n';

/**
 * Calque des références **en préparation** : posées au collage, déplaçables et
 * redimensionnables jusqu'à l'envoi du commentaire.
 *
 * Il passe au-dessus du canvas d'annotation et porte ses propres événements : sous le canvas
 * armé, la référence restait clouée quel que soit l'outil. Un glisser entier ne compte qu'un
 * cran d'annulation (`step`), et le premier geste posé ailleurs rend la main au tracé.
 *
 * Le geste va **où le pointeur va**, sur tout le canevas du viewer et non dans le seul cadre du
 * média : c'est ici, au contact de la géométrie, qu'on borne au visible — pas dans le composer,
 * qui ne connaît pas le viewer. Sortie du viewer, la référence serait rognée jusqu'au test de
 * survol : ni reprise, ni supprimable.
 */
export default function StagedRefLayer({ ann }: { ann: Annotations }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    key: string;
    mode: 'move' | 'resize';
    px: number;
    py: number;
    start: { x: number; y: number; width: number };
    /** Boîte déplacée : sa hauteur rendue borne le geste sans qu'on la devine. */
    el: HTMLElement;
    step: string;
  } | null>(null);

  const { tool, exitRefTool } = ann;
  useEffect(() => {
    if (tool !== 'ref') return;
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) exitRefTool();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [tool, exitRefTool]);

  const onPointerDown = (key: string, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    const r = ann.stagedRefs.find((s) => s.key === key);
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    drag.current = {
      key,
      mode,
      px: e.clientX,
      py: e.clientY,
      start: { x: r.x, y: r.y, width: r.width },
      // La poignée de taille est fille de la boîte ; le déplacement se prend sur la boîte même.
      el: mode === 'move' ? target : (target.parentElement ?? target),
      step: Math.random().toString(36).slice(2, 9),
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const root = rootRef.current;
    const d = drag.current;
    if (!d || !root) return;
    const rect = root.getBoundingClientRect();
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    if (d.mode === 'resize') {
      ann.updateStagedRef(d.key, { width: d.start.width + dx }, d.step);
      return;
    }
    // Le canevas se remesure à chaque mouvement : le zoom du viewer ne déclenche aucun
    // observateur, et une zone mémorisée au premier contact aurait déjà vieilli.
    const canvas = viewerCanvas(root);
    const height = d.el.getBoundingClientRect().height / rect.height;
    const moved = { x: d.start.x + dx, y: d.start.y + dy, width: d.start.width };
    const { x, y } = onCanvasRefBox(moved, height, canvas);
    ann.updateStagedRef(d.key, { x, y }, d.step);
  };
  const onPointerUp = () => (drag.current = null);

  if (ann.stagedRefs.length === 0) return null;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30 overflow-visible">
      {ann.stagedRefs.map((r) => (
        <div
          key={r.key}
          title={t('review.ref.drag')}
          className="pointer-events-auto absolute cursor-move overflow-hidden rounded border-2 border-primary/70 shadow-lg"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%` }}
          onPointerDown={onPointerDown(r.key, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img src={r.dataUrl} alt={t('ref.draft')} className="block w-full select-none" draggable={false} />
          <button
            type="button"
            onClick={() => ann.removeStagedRef(r.key)}
            title={t('review.ref.remove')}
            className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <Trash2 size={12} />
          </button>
          <div
            onPointerDown={onPointerDown(r.key, 'resize')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title={t('common.resize')}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-primary/70"
          />
        </div>
      ))}
    </div>
  );
}
