// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arbitrage « que montrer à la place du contenu » pour une requête TanStack.
 *
 * Les écrans d'administration gardaient tous la même forme — `if (!data) return
 * <SkeletonRows />` — qui confond deux situations que l'exploitant doit distinguer :
 * la donnée arrive, ou le serveur a répondu 500. Dans le second cas le squelette
 * pulsait indéfiniment, sans message ni autre moyen de relancer que F5.
 *
 * La décision est isolée ici, hors de React, pour être testée : le composant
 * `QueryState` ne fait plus que peindre la phase choisie.
 */

/** Ce qu'un écran affiche à la place de son contenu. */
export type QueryPhase = 'pending' | 'error' | 'ready';

/** Les seuls signaux lus sur une requête — deux booléens, tous deux portés par TanStack. */
export interface QuerySnapshot {
  /** La dernière tentative a échoué (`status === 'error'`). */
  isError: boolean;
  /** Des données exploitables sont en main (réponse fraîche, cache, page précédente). */
  hasData: boolean;
}

/**
 * Ordre de priorité :
 *
 * 1. **Données en main → `ready`.** Un rafraîchissement en échec n'efface pas un écran
 *    déjà rempli : l'exploitant garde le contenu, quitte à ce qu'il vieillisse. C'est ce
 *    qui rend la primitive sûre sur les listes paginées (`keepPreviousData`).
 * 2. **Échec sans données → `error`.** Rien à montrer : l'écran le dit et propose la
 *    reprise.
 * 3. **Le reste → `pending`.** Chargement initial, mais aussi requête désactivée
 *    (`enabled: false`) ou succès sans corps — on retombe sur le squelette, qui était
 *    déjà le comportement en place.
 *
 * `isFetching` est délibérément absent : le faire primer sur l'échec ferait clignoter
 * squelette et panneau d'erreur toutes les cinq secondes sur les écrans qui sondent
 * (`refetchInterval`, cf. la page des jobs). Le panneau reste donc affiché pendant la
 * reprise, et disparaît quand elle aboutit.
 */
export function resolveQueryPhase({ isError, hasData }: QuerySnapshot): QueryPhase {
  if (hasData) return 'ready';
  return isError ? 'error' : 'pending';
}
