// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import CollapsibleText from '../../../components/comments/CollapsibleText';
import type { PoiCardImage } from './poiCards';
import { useT } from '../../../i18n';

/**
 * La remarque d'un point d'intérêt, telle qu'elle se LIT — au fil des commentaires comme sur
 * la carte ancrée dans la scène. Une seule écriture pour les deux surfaces : la remarque se
 * lisait différemment selon l'endroit, et débordait des deux façons possibles.
 *
 * Trois règles, demandées à l'usage :
 *
 *  - **rien ne défile en largeur** : le texte revient à la ligne, et `break-words` coupe même
 *    ce qui n'a pas d'espace — un chemin de plan, une URL de rendu — au lieu de pousser la
 *    rangée hors de la colonne ;
 *  - **trois lignes, pas plus** tant qu'on n'a pas déroulé : le repliage du lot 5
 *    (`CollapsibleText`) est réemployé tel quel, serré à trois lignes ;
 *  - **la miniature à côté du texte**, jamais dessous : c'est ce qui permet de balayer un fil
 *    de points en voyant du premier coup d'œil de quoi chacun parle.
 *
 * Au-delà d'une image, la suite passe par une tuile « +n » — la même convention que les pièces
 * jointes d'un commentaire (`CommentAttachmentList`) — et tout s'ouvre dans la Lightbox
 * partagée, celle du fil et de la review image.
 */

/** Trois lignes : ce qu'une remarque montre sans qu'on ait à la dérouler. */
const NOTE_LINES = 3;

export default function PoiNoteBody({
  text,
  images,
  onImage,
  stop,
  className,
}: {
  text: string;
  images: readonly PoiCardImage[];
  /** Ouvre la Lightbox partagée sur l'image de ce rang. */
  onImage: (at: number) => void;
  /** Empêche un clic interne de rejouer la sélection de la carte du commentaire. */
  stop?: (e: React.MouseEvent) => void;
  /** Typographie de la surface d'accueil : `text-sm` au fil, `text-xs` dans la scène. */
  className?: string;
}) {
  const t = useT();
  const openAt = (e: React.MouseEvent, at: number) => {
    stop?.(e);
    onImage(at);
  };
  const [first, ...rest] = images;

  return (
    <div className="flex items-start gap-1.5">
      {/* `min-w-0` : sans lui, un enfant de flex refuse de rétrécir sous la largeur de son
          contenu — c'est exactement ce qui faisait défiler la rangée en largeur. */}
      <div className={`min-w-0 flex-1 ${className ?? ''}`}>
        <CollapsibleText text={text} lines={NOTE_LINES} className="whitespace-pre-wrap break-words">
          {text}
        </CollapsibleText>
      </div>
      {first && (
        <div className="flex shrink-0 items-start gap-1">
          <button
            type="button"
            onClick={(e) => openAt(e, 0)}
            title={first.alt || t('comments.openAttachment')}
            aria-label={t('comments.openAttachment')}
          >
            <img
              src={first.src}
              alt={first.alt}
              className="h-12 w-12 rounded border border-border object-cover"
            />
          </button>
          {rest.length > 0 && (
            <button
              type="button"
              onClick={(e) => openAt(e, 1)}
              title={t('comment.seeAllImages')}
              aria-label={t('comment.seeAllImages')}
              className="flex h-12 w-12 flex-col items-center justify-center rounded border border-border bg-secondary/60 text-2xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <span className="text-xs font-semibold">+{rest.length}</span>
              {t('comment.images')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
