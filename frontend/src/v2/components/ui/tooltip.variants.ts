// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from '../../lib/utils';

/**
 * Réglages et habillage de l'infobulle, isolés du composant pour être vérifiables sans
 * rendu (même découpage que `button.variants.ts` / `card.variants.ts`).
 *
 * ## Le délai est un choix de produit
 *
 * L'infobulle native du navigateur attend ~1,5 s. Sur un bouton à icône seule, où elle est
 * la seule chose qui dit ce que fait le bouton, cette attente est le défaut lui-même :
 * l'utilisateur qui demande « c'est quoi ? » paie une seconde et demie pour l'apprendre.
 *
 * D'où **250 ms** : sous le seuil des ~400 ms où une interface cesse d'être ressentie comme
 * immédiate, mais au-dessus des ~150 ms d'un survol de passage — sinon balayer une barre de
 * transport dense fait clignoter une infobulle par bouton traversé.
 *
 * `TOOLTIP_SKIP_DELAY_MS` complète : une fois une infobulle ouverte, les suivantes
 * s'affichent **sans délai** pendant cette fenêtre. C'est ce qui rend une barre dense
 * lisible — on la parcourt, on ne l'interroge pas bouton par bouton.
 */
export const TOOLTIP_DELAY_MS = 250;

/** Fenêtre pendant laquelle l'infobulle suivante s'ouvre immédiatement (cf. ci-dessus). */
export const TOOLTIP_SKIP_DELAY_MS = 500;

/**
 * Un libellé absent ne monte pas d'infobulle du tout.
 *
 * Les appelants transmettent souvent une valeur optionnelle (`shortcut`, libellé calculé) ;
 * sans ce filtre, une chaîne vide ouvrirait un panneau vide au survol. Les espaces seuls
 * comptent comme absents — ils ne donnent rien à lire.
 */
export function shouldRenderTooltip(label: unknown): boolean {
  if (label === undefined || label === null || label === false) return false;
  if (typeof label === 'string') return label.trim().length > 0;
  return true;
}

/**
 * Habillage du panneau.
 *
 * Deux points que les tests verrouillent :
 *
 *  1. **`z-[60]`, pas `z-50`.** Tous les calques flottants du dossier (dialog, sheet,
 *     popover, context-menu, lightbox) sont à `z-50`. Une infobulle déclenchée depuis un
 *     bouton d'en-tête de modale est portalisée sur `body` comme la modale elle-même : à
 *     égalité de `z-index`, seul l'ordre du DOM tranche, et il dépend de l'ordre de montage.
 *     Un cran au-dessus rend le résultat indépendant de cet ordre. `z-[60]` est déjà le
 *     cran « au-dessus de tout » du dépôt (cf. `FullPageDropzone`).
 *  2. **`data-[state=delayed-open]` / `data-[state=instant-open]`, jamais `data-[state=open]`.**
 *     Radix Tooltip n'écrit pas `open` dans son `data-state`, contrairement au popover et au
 *     dialog : recopier les classes du popover donne un panneau qui n'anime jamais son
 *     entrée. Les deux états sont couverts, l'ouverture immédiate (fenêtre de grâce
 *     ci-dessus) comme l'ouverture retardée.
 */
export function tooltipContentClass(className?: string): string {
  return cn(
    'z-[60] max-w-xs rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-xl',
    'data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in data-[state=closed]:animate-out',
    'data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0 data-[state=closed]:fade-out-0',
    'data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95 data-[state=closed]:zoom-out-95',
    className,
  );
}
