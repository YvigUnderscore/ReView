// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, Images } from 'lucide-react';
import { Lightbox } from '../../../components/ui/lightbox';
import { POI_CARD_ATTR, sameAnchors, subscribePoiAnchors } from './poiAnchor';
import {
  poiCardAbove,
  poiCardSide,
  type PoiCardImage,
  type PoiCardSide,
  type PoiSceneCard,
} from './poiCards';
import { useT } from '../../../i18n';

/**
 * Le commentaire relu, **dans la scène** : une carte par point, ancrée à sa pastille.
 *
 * Ce qui a été demandé : « qu'on voie à la fois le commentaire avec le ou les images associées […]
 * réellement affiché dans le viewer 3D, qu'on puisse naviguer dans la scène, s'approcher d'un
 * commentaire, le voir ». La forme retenue est l'**étiquette qui s'ouvre** :
 *
 *  - la carte du premier point est ouverte d'office — le commentaire se LIT en arrivant, il ne se
 *    déplie pas ; les autres points restent des étiquettes d'une ligne ;
 *  - une seule carte ouverte à la fois : deux cartes ouvertes se recouvrent dès que deux points
 *    sont proches, et c'est précisément le cas qui devait rester lisible ;
 *  - la carte est bornée (largeur fixe, texte qui défile) : un commentaire long ou six images ne
 *    masquent pas la scène, on les parcourt sur place ;
 *  - les images s'ouvrent en grand dans la Lightbox partagée, celle du fil et de la review image.
 *
 * Le coût de rendu est nul côté viewer : le calque ne se projette pas, il s'ancre dans la pastille
 * (`poiAnchor`) et suit sa transformation. La seule mesure — de quel côté la carte ouverte tient
 * sans sortir du viewer — se fait à l'ouverture et à la **fin** d'un geste de navigation, jamais
 * par image.
 */

/**
 * Marque d'une carte : la zone de review s'en sert pour distinguer « je lis un commentaire » de
 * « je navigue dans la scène » (`isPoiCardGesture`), dont les conséquences diffèrent.
 */
const CARD_MARK = { [POI_CARD_ATTR]: '' } as const;

/** Placement de la carte autour de sa pastille : un côté, une classe. */
const SIDE_CLASS: Record<PoiCardSide, string> = {
  center: 'left-1/2 -translate-x-1/2',
  right: 'left-0',
  left: 'right-0',
};

/** Sous la pastille, ou au-dessus quand le bord bas du viewer écrêterait la carte. */
const ROW_CLASS = { below: 'top-6', above: 'bottom-6' } as const;

/** Où la carte OUVERTE se pose : mesuré, jamais deviné (cf. l'effet de mesure plus bas). */
interface Placement {
  side: PoiCardSide;
  above: boolean;
}

function PoiCard({
  card,
  open,
  onToggle,
  onImage,
}: {
  card: PoiSceneCard;
  open: boolean;
  onToggle: () => void;
  onImage: (images: PoiCardImage[], at: number) => void;
}) {
  const t = useT();
  const n = card.index + 1;
  if (!open)
    return (
      <button
        type="button"
        {...CARD_MARK}
        onClick={onToggle}
        title={t('poi.card.open', { n })}
        aria-label={t('poi.card.open', { n })}
        className="pointer-events-auto flex max-w-[9rem] items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-0.5 text-2xs text-foreground shadow backdrop-blur hover:bg-secondary"
      >
        {/* `min-w-0` : sans lui, un enfant de flex refuse de rétrécir et l'étiquette ne se
            coupe jamais — elle pousserait le compteur d'images hors de la pastille. */}
        <span className="min-w-0 truncate">{card.text || card.intro}</span>
        {card.images.length > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <Images size={11} />
            {card.images.length}
          </span>
        )}
      </button>
    );

  const body = [card.intro, card.text].filter((s) => !!s).join('\n\n');
  return (
    <div
      {...CARD_MARK}
      className="pointer-events-auto w-60 max-w-[15rem] space-y-1 rounded-md border border-border bg-card/95 p-2 text-left shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-1">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
          {n}
        </span>
        {card.author && (
          <span className="min-w-0 flex-1 truncate text-2xs font-semibold text-muted-foreground">
            {card.author}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={t('poi.card.close', { n })}
          aria-label={t('poi.card.close', { n })}
          className="ml-auto shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronUp size={12} />
        </button>
      </div>
      {body && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-foreground">{body}</p>}
      {card.images.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.images.map((img, at) => (
            <button
              key={img.src}
              type="button"
              onClick={() => onImage(card.images, at)}
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
        </div>
      )}
    </div>
  );
}

export default function PoiSceneCards({
  containerRef,
  cards,
}: {
  /** Conteneur du viewer : les pastilles y vivent, et leur annonce y passe (`poiAnchor`). */
  containerRef: RefObject<HTMLElement | null>;
  cards: readonly PoiSceneCard[];
}) {
  const [anchors, setAnchors] = useState<HTMLElement[]>([]);
  // Le commentaire doit se lire en arrivant : la carte du premier point est ouverte d'office.
  // L'état repart de zéro à chaque commentaire — le calque est monté avec sa clé.
  const [open, setOpen] = useState<number | null>(cards[0]?.index ?? null);
  const [place, setPlace] = useState<Placement>({ side: 'center', above: false });
  const [lightbox, setLightbox] = useState<{ images: PoiCardImage[]; at: number } | null>(null);

  useEffect(
    () =>
      subscribePoiAnchors(containerRef.current, (next) =>
        setAnchors((prev) => (sameAnchors(prev, next) ? prev : next)),
      ),
    [containerRef, cards],
  );

  const openAnchor = open != null ? anchors[open] : undefined;
  useEffect(() => {
    const box = containerRef.current;
    if (!box || !openAnchor) return;
    const measure = () => {
      const view = box.getBoundingClientRect();
      const anchor = openAnchor.getBoundingClientRect();
      setPlace((prev) => {
        const next = {
          side: poiCardSide(anchor.left - view.left, view.width),
          above: poiCardAbove(anchor.top - view.top, view.height),
        };
        return prev.side === next.side && prev.above === next.above ? prev : next;
      });
    };
    measure();
    // Fin de geste seulement. La projection, elle, se refait à chaque image dessinée : mesurer
    // avec elle réveillerait le viewer en permanence (cf. `viewer/renderScheduler`).
    box.addEventListener('pointerup', measure);
    box.addEventListener('wheel', measure, { passive: true });
    return () => {
      box.removeEventListener('pointerup', measure);
      box.removeEventListener('wheel', measure);
    };
  }, [openAnchor, containerRef]);

  return (
    <>
      {cards.map((card) => {
        const anchor = anchors[card.index];
        const isOpen = open === card.index;
        return anchor
          ? createPortal(
              <div
                className={`pointer-events-none absolute z-10 ${isOpen ? `${SIDE_CLASS[place.side]} ${ROW_CLASS[place.above ? 'above' : 'below']}` : `${SIDE_CLASS.center} ${ROW_CLASS.below}`}`}
              >
                <PoiCard
                  card={card}
                  open={isOpen}
                  onToggle={() => setOpen(isOpen ? null : card.index)}
                  onImage={(images, at) => setLightbox({ images, at })}
                />
              </div>,
              anchor,
              String(card.index),
            )
          : null;
      })}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.at}
          open
          onOpenChange={(next) => !next && setLightbox(null)}
          onIndexChange={(at) => setLightbox((l) => (l ? { ...l, at } : l))}
        />
      )}
    </>
  );
}
