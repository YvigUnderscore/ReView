// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  shouldRenderTooltip,
  tooltipContentClass,
} from './tooltip.variants';

/**
 * Infobulle accessible (Radix) : portal, positionnement automatique, fermeture Échap,
 * ouverture au survol **et au focus clavier**. Elle remplace l'attribut `title` natif, qui
 * attend ~1,5 s, ne se style pas, ignore le thème et n'apparaît jamais au clavier.
 *
 * ## Elle ne nomme pas le contrôle — elle le décrit
 *
 * Point à ne pas confondre : Radix pose `aria-describedby` sur le déclencheur, pas
 * `aria-labelledby`. Une infobulle n'est donc **jamais** un substitut au nom accessible.
 * Un bouton à icône seule garde son `aria-label` : c'est lui que le lecteur d'écran
 * annonce, et c'est la seule information qui survive au tactile, où aucune infobulle ne
 * s'ouvre (ni la native, ni celle-ci).
 *
 * Contrepartie assumée quand l'infobulle reprend mot pour mot l'`aria-label` (le cas de
 * `IconButton`) : à l'ouverture, le lecteur d'écran annonce le nom puis la description,
 * donc deux fois le même mot. C'est le comportement de tout le monde (shadcn, Radix), et
 * c'est le moindre mal — supprimer l'`aria-label` rendrait le bouton anonyme au tactile et
 * pour tout lecteur qui n'ouvre pas l'infobulle.
 */
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Marqueur de présence du provider.
 *
 * Radix **lève** quand un `Tooltip` n'a pas de provider au-dessus de lui, et une exception
 * de rendu n'est pas rattrapable localement : elle remonte à l'`ErrorBoundary` la plus
 * proche et vide tout le sous-arbre. Un bouton à icône, posé dans une racine React montée à
 * part, ferait donc disparaître la page qui l'entoure. Trop de dégâts pour une décoration.
 *
 * D'où ce contexte, qui n'existe que pour répondre « y a-t-il un provider ? » — question à
 * laquelle le contexte de Radix, non exporté, ne permet pas de répondre. Quand la réponse
 * est non, `Tooltip` se fournit le sien : on perd la fenêtre de grâce partagée, jamais
 * l'affichage.
 */
const HasTooltipProvider = createContext(false);

/**
 * Un seul provider, monté haut dans l'arbre (cf. `App.tsx`).
 *
 * En poser un par bouton coûterait un contexte par bouton **et** ferait perdre la fenêtre
 * de grâce : c'est le provider qui la mémorise, donc c'est lui qui permet de balayer une
 * barre dense sans repayer le délai à chaque icône. Les deux réglages sont donc portés ici,
 * une fois.
 */
function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return (
    <HasTooltipProvider.Provider value={true}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </HasTooltipProvider.Provider>
  );
}

const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={tooltipContentClass(className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Raccourci pour le cas courant : envelopper un contrôle déjà nommé.
 *
 * `asChild` sur le déclencheur — l'infobulle ne doit pas introduire de balise
 * supplémentaire autour du bouton : elle casserait les barres en `flex` et les sélecteurs
 * de voisinage. Un `label` vide ne monte rien du tout, pour que les appelants puissent
 * passer une valeur optionnelle sans se garder eux-mêmes.
 */
export function RadixTooltip({
  label,
  side,
  children,
}: {
  label?: ReactNode;
  side?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  children: ReactNode;
}) {
  const hasProvider = useContext(HasTooltipProvider);
  if (!shouldRenderTooltip(label)) return <>{children}</>;
  const tooltip = (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </TooltipRoot>
  );
  // Repli isolé : mieux vaut une fenêtre de grâce perdue qu'un sous-arbre effacé.
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };
