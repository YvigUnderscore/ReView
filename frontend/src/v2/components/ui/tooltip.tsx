// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cloneElement,
  isValidElement,
  useEffect,
  useReducer,
  type ReactElement,
  type ReactNode,
} from 'react';
import { shouldRenderTooltip } from './tooltip.variants';

/**
 * Façade de l'infobulle — la seule chose que les composants importent.
 *
 * ## Pourquoi une façade
 *
 * Radix Tooltip pèse ~10 ko gzip. Importé par `IconButton`, qui est sur le chemin d'entrée,
 * il entrait dans le **premier chargement** : 429,8 ko pour un budget de 430,0, soit 0,2 ko
 * de marge — le changement suivant, quel qu'il soit, aurait fait échouer la suite. Or une
 * infobulle est par définition inutile au premier rendu : personne ne survole un bouton
 * qui n'est pas encore peint.
 *
 * Ce module ne contient donc aucun code Radix. Il rend l'enfant tel quel, demande le vrai
 * module dès que le navigateur est inoccupé, et bascule dessus quand il arrive. Entre les
 * deux, l'attribut `title` natif tient le rôle : c'est ce qu'il y avait avant, ce n'est pas
 * une régression, et cela ne dure que le temps d'un chargement de chunk.
 *
 * ## Ce qui se perd, et pourquoi c'est le bon compromis
 *
 * Le provider de Radix mémorise la **fenêtre de grâce** — balayer une barre dense sans
 * repayer le délai à chaque icône. Le monter à la racine imposerait de l'avoir dès le
 * premier rendu (donc dans le chunk d'entrée : on tourne en rond) ou de l'insérer plus tard
 * au-dessus de l'application, ce qui la **remonterait entièrement**. Chaque infobulle se
 * fournit donc son provider, avec les mêmes délais. On perd la grâce partagée : survoler la
 * deuxième icône d'une barre repaie 250 ms. On reste six fois plus rapide que le `title`
 * natif qu'on remplace, et sans peser sur le premier écran de tous les visiteurs.
 */

type Module = typeof import('./tooltip.radix');

let chargee: Module | null = null;
let enCours: Promise<Module> | null = null;
const abonnes = new Set<() => void>();

/** Une seule demande pour toute l'application, quel que soit le nombre d'infobulles. */
function demander(): Promise<Module> {
  enCours ??= import('./tooltip.radix').then((m) => {
    chargee = m;
    // Copie : un abonné qui se retire pendant la diffusion ne doit pas décaler l'itération.
    for (const prevenir of [...abonnes]) prevenir();
    return m;
  });
  return enCours;
}

/** `requestIdleCallback` manque encore à Safari : le repli n'a pas à être fin, juste tardif. */
function quandLibre(tache: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(tache, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(tache, 400);
  return () => clearTimeout(id);
}

function useModuleInfobulle(): Module | null {
  const [, redessiner] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (chargee) return;
    abonnes.add(redessiner);
    const annuler = quandLibre(() => void demander());
    return () => {
      abonnes.delete(redessiner);
      annuler();
    };
  }, []);
  return chargee;
}

/**
 * Enveloppe un contrôle déjà nommé. `label` vide ne monte rien : les appelants peuvent
 * passer une valeur optionnelle sans se garder eux-mêmes.
 */
export function Tooltip({
  label,
  side,
  children,
}: {
  label?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  const module = useModuleInfobulle();
  if (!shouldRenderTooltip(label)) return <>{children}</>;

  if (!module) {
    // Repli le temps du chargement. `title` n'accepte qu'une chaîne : un libellé riche
    // (rare) n'a pas de repli, et n'en avait pas davantage avant cette primitive.
    return typeof label === 'string' && isValidElement(children) ? (
      cloneElement(children as ReactElement<{ title?: string }>, { title: label })
    ) : (
      <>{children}</>
    );
  }

  const { RadixTooltip } = module;
  return (
    <RadixTooltip label={label} side={side}>
      {children}
    </RadixTooltip>
  );
}
