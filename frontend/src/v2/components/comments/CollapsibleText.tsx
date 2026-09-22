// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { isClipped, plainLength } from './collapse';
import { useT } from '../../i18n';

/**
 * Un contenu qui ne tient pas dans sa surface s'ouvre replié (D6) et se déplie au clic.
 *
 * Le texte entier reste DANS le document : on le masque en hauteur, jamais en le tronquant.
 * Un Ctrl+F, un lecteur d'écran et une recherche du navigateur continuent donc de le
 * trouver, replié ou non — et l'indicateur dit ce qu'il cache.
 *
 * Deux serrages, un seul motif : le commentaire du fil se masque en HAUTEUR (`max-h`), la
 * remarque d'un point d'intérêt se coupe en LIGNES (`lines`) — trois, pas plus, sinon les
 * cartes ancrées dans la scène masquent ce qu'on relit.
 *
 * L'indicateur, lui, ne se déduit plus du nombre de caractères : il suit la MESURE du
 * débordement (`isClipped`). Estimer coûtait des deux côtés — un bouton « dérouler 77
 * caractères » qui ne révélait rien dans le fil, large, et un commentaire réellement coupé
 * sans bouton pour l'ouvrir dès que la colonne se rétrécissait.
 */

/**
 * Repliage serré : combien de lignes restent lisibles. Tailwind ne voit que les classes
 * écrites en toutes lettres — d'où la table, plutôt qu'une classe composée à la volée.
 */
const CLAMP_CLASS = { 3: 'line-clamp-3' } as const;

/** Repliage par défaut : une hauteur, celle d'un commentaire de fil qu'on survole. */
const MAX_HEIGHT_CLASS = 'max-h-32 overflow-hidden';

export default function CollapsibleText({
  text,
  lines,
  className,
  children,
}: {
  text: string;
  /** Repliage serré : le contenu ne montre que N lignes tant qu'on ne l'a pas déplié. */
  lines?: keyof typeof CLAMP_CLASS;
  /**
   * Classes du contenu replié. Couper des LIGNES se fait sur l'élément qui les porte : un
   * bloc intercalé entre lui et le texte annulerait la coupe — d'où ces classes ici, et
   * non sur un enfant.
   */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * Le repliage cache-t-il vraiment quelque chose ? On le mesure sur l'élément replié, et on
   * le REmesure quand la surface change de taille : c'est la largeur qui décide combien de
   * caractères tiennent sur une ligne, et elle bouge (panneau redimensionné, carte ancrée
   * qui change de côté, fenêtre).
   *
   * Déplié, l'élément ne déborde plus : on garde alors la dernière mesure, sinon l'indicateur
   * de repli disparaîtrait au moment même où il sert.
   */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return;
    const measure = () => setClipped(isClipped(el));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);

  const clamp = lines ? CLAMP_CLASS[lines] : MAX_HEIGHT_CLASS;

  return (
    <div>
      <div ref={bodyRef} className={`${className ?? ''} ${open ? '' : clamp}`.trim() || undefined}>
        {children}
      </div>
      {clipped && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? t('comments.collapseComment') : t('comments.expandComment', { count: plainLength(text) })}
        </button>
      )}
    </div>
  );
}
