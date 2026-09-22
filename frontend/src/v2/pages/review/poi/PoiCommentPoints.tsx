// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Lightbox } from '../../../components/ui/lightbox';
import { isImageAttachment, type CommentAttachment } from '../../../../lib/commentAttachments';
import type { PoiPoint } from './poiPoints';
import { useT } from '../../../i18n';

/**
 * Points d'intérêt d'un commentaire, à la relecture : une rangée numérotée par point, sa
 * remarque, et ses images.
 *
 * **Cliquer le numéro ramène la caméra sur le point** (`onFocus`). Le rejeu vaut pour tout
 * spectateur : le point est stocké en espace OBJET, comme la présentation caméra, donc le
 * cadrage retombe au même endroit quelle que soit la transformation du média.
 *
 * Sans `onFocus` — l'écran n'a pas de viewer spatial sous la main — les numéros restent du
 * texte : on lit la remarque, on ne vole pas vers elle.
 */
export default function PoiCommentPoints({
  points,
  attachments,
  onFocus,
  stop,
}: {
  points: readonly PoiPoint[];
  attachments?: readonly CommentAttachment[];
  onFocus?: (point: PoiPoint, index: number) => void;
  /** Empêche un clic interne de rejouer la sélection de la carte du commentaire. */
  stop: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  // Carrousel commun : l'index porte sur les images de CE point (le lot ouvert), pas du fil.
  const [lightbox, setLightbox] = useState<{ images: { src: string; alt: string }[]; at: number } | null>(
    null,
  );
  if (points.length === 0) return null;

  const imagesOf = (point: PoiPoint) =>
    (point.images ?? [])
      .map((key) => attachments?.find((a) => a.key === key))
      .filter((a): a is CommentAttachment => !!a?.url && isImageAttachment(a.contentType))
      .map((a) => ({ src: a.url ?? '', alt: a.name ?? '' }));

  return (
    <ol aria-label={t('poi.listLabel')} className="mt-1 space-y-1">
      {points.map((point, index) => {
        const images = imagesOf(point);
        return (
          <li key={index} className="flex items-start gap-1.5 text-sm">
            {onFocus ? (
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  onFocus(point, index);
                }}
                title={t('poi.focus', { n: index + 1 })}
                aria-label={t('poi.focus', { n: index + 1 })}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {index + 1}
              </button>
            ) : (
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="whitespace-pre-wrap">{point.text ?? ''}</span>
              {images.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {images.map((img, at) => (
                    <button
                      key={img.src}
                      type="button"
                      onClick={(e) => {
                        stop(e);
                        setLightbox({ images, at });
                      }}
                      title={img.alt || t('comments.openAttachment')}
                      aria-label={t('comments.openAttachment')}
                    >
                      <img
                        src={img.src}
                        alt={img.alt}
                        className="h-12 w-12 rounded border border-border object-cover"
                      />
                    </button>
                  ))}
                </span>
              )}
            </span>
          </li>
        );
      })}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.at}
          open
          onOpenChange={(open) => !open && setLightbox(null)}
          onIndexChange={(at) => setLightbox((l) => (l ? { ...l, at } : l))}
        />
      )}
    </ol>
  );
}
