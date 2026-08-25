// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Grid2x2, X } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * Le carrousel de références d'une fiche.
 *
 * On regarde une planche de références de deux façons, et il faut les deux : une par une,
 * en grand, quand on cherche un détail — et toutes ensemble, quand on cherche la cohérence
 * d'un ensemble. Le carrousel fait la première, le bouton « tout voir » la seconde, et la
 * planche s'ouvre en superposition parce qu'une grille de douze images dans un en-tête
 * repousserait le travail hors de l'écran.
 */
export default function NoteRefs({ images }: { images: { src: string; alt: string }[] }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [grid, setGrid] = useState(false);

  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];
  const go = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);

  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-md border border-border bg-secondary/30">
        <img
          src={current.src}
          alt={current.alt}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-64 w-full object-contain"
        />
        {images.length > 1 && (
          <>
            <button
              onClick={() => go(-1)}
              aria-label={t('refs.previous')}
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => go(1)}
              aria-label={t('refs.next')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        {current.alt && <span className="truncate">{current.alt}</span>}
        <span className="ml-auto shrink-0 tabular-nums">
          {index + 1} / {images.length}
        </span>
        {images.length > 1 && (
          <button
            onClick={() => setGrid(true)}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-secondary/60"
          >
            <Grid2x2 size={12} /> {t('refs.seeAll')}
          </button>
        )}
      </div>

      {grid && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('refs.seeAll')}
          className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-6"
        >
          <button
            onClick={() => setGrid(false)}
            aria-label={t('common.close')}
            className="absolute right-4 top-4 rounded-md p-1.5 hover:bg-secondary"
          >
            <X size={18} />
          </button>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {images.map((image, i) => (
              <button
                key={i}
                onClick={() => {
                  // Choisir une image dans la planche revient à la mettre au carrousel :
                  // c'est le geste attendu quand on veut l'examiner de près.
                  setIndex(i);
                  setGrid(false);
                }}
                className="overflow-hidden rounded-md border border-border transition-colors hover:border-primary"
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-video w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
