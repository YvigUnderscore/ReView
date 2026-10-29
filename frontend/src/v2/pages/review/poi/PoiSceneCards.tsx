// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, Images } from 'lucide-react';
import { Lightbox } from '../../../components/ui/lightbox';
import PoiNoteBody from './PoiNoteBody';
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
 * The reviewed comment, **in the scene**: one card per point, anchored to its hotspot.
 *
 * What was requested: "to see at once the comment with its associated image(s) […] actually displayed in
 * the 3D viewer, to be able to navigate the scene, to approach a comment, to see it". The form chosen is
 * the **label that opens**:
 *
 *  - the card of the first point is open by default: the comment is READ on arrival, it does not unfold;
 *    the other points remain one-line labels;
 *  - only one card open at a time: two open cards overlap as soon as two points are close, and that is
 *    precisely the case that had to remain readable;
 *  - the card is bounded (fixed width, three lines of text, thumbnail beside it: `PoiNoteBody`): a long
 *    comment or six images do not hide the scene; they unfold in place;
 *  - the images open full size in the shared Lightbox, the one of the thread and of the image review.
 *
 * The rendering cost is nil on the viewer side: the layer does not project, it anchors itself to the
 * hotspot (`poiAnchor`) and follows its transform. The only measurement, of which side the open card fits
 * on without leaving the viewer, is taken on opening and at the **end** of a navigation gesture, never per frame.
 */

/**
 * Mark of a card: the review area uses it to distinguish "I am reading a comment" from "I am navigating
 * the scene" (`isPoiCardGesture`), whose consequences differ.
 */
const CARD_MARK = { [POI_CARD_ATTR]: '' } as const;

/** Placement of the card around its hotspot: one side, one class. */
const SIDE_CLASS: Record<PoiCardSide, string> = {
  center: 'left-1/2 -translate-x-1/2',
  right: 'left-0',
  left: 'right-0',
};

/** Under the hotspot, or above it when the bottom edge of the viewer would clip the card. */
const ROW_CLASS = { below: 'top-6', above: 'bottom-6' } as const;

/** Where the OPEN card sits: measured, never guessed (see the measuring effect below). */
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
        {/* `min-w-0`: without it, a flex child refuses to shrink and the label never
            truncates: it would push the image counter out of the hotspot. */}
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
      {(body || card.images.length > 0) && (
        <PoiNoteBody
          text={body}
          images={card.images}
          onImage={(at) => onImage(card.images, at)}
          className="text-xs text-foreground"
        />
      )}
    </div>
  );
}

export default function PoiSceneCards({
  containerRef,
  cards,
}: {
  /** Viewer container: the hotspots live there, and their announcement passes through it (`poiAnchor`). */
  containerRef: RefObject<HTMLElement | null>;
  cards: readonly PoiSceneCard[];
}) {
  const [anchors, setAnchors] = useState<HTMLElement[]>([]);
  // The comment must be readable on arrival: the card of the first point is open by default.
  // The state restarts from zero for each comment: the layer is mounted with its key.
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
    // End of gesture only. The projection, for its part, is redone at each drawn frame: measuring
    // with it would wake the viewer permanently (see `viewer/renderScheduler`).
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
