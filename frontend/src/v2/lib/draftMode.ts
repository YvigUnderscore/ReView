// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useBranding } from './branding';

/**
 * Mode brouillon — le seul endroit du frontend qui décide si le studio travaille en deux
 * temps (déposer, puis publier) ou en un seul (un média naît publié).
 *
 * Depuis la Phase 50, un média est publié dès l'upload : le brouillon n'est plus le
 * parcours normal mais une **option de studio**, éteinte par défaut. Tout ce qui parle de
 * brouillon à l'écran — la pastille des brouillons en attente, le filtre « Mes
 * brouillons » — se règle donc sur ce réglage, et non sur une constante.
 *
 * Le réglage voyage avec l'identité publique du studio (`/api/studio/branding`) : c'est le
 * seul canal que TOUT le monde peut lire, y compris un artiste qui n'a pas accès aux
 * réglages d'administration. `useStudioSettings` ne sert qu'à l'écrire.
 */

/** Clé du réglage dans la table `Setting` — contrat partagé avec le backend. */
export const DRAFT_MODE_KEY = 'draftMode';

/**
 * Le réglage est-il actif ?
 *
 * La table `Setting` ne stocke que du texte : le réglage arrive donc tantôt en booléen
 * (branding), tantôt en chaîne (écran d'administration). Un seul verdict pour les deux, et
 * tout ce qui n'est pas explicitement vrai vaut faux — un réglage absent doit donner le
 * comportement par défaut, la publication d'office.
 */
export function isDraftModeOn(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  const text = value.trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'on';
}

/** Ce que le réglage vaut pour l'écran courant. */
export function useDraftMode(): boolean {
  const { data } = useBranding();
  return isDraftModeOn(data?.draftMode);
}
