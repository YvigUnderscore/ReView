// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Politique du clic droit dans l'application (A3).
 *
 * Le menu natif du navigateur n'a pas sa place dans un outil de studio : il masque le
 * contenu et ne propose rien d'utile. Mais le remplacer partout par un menu générique
 * n'était pas mieux — le même menu s'ouvrait sur une carte de plan, sur un titre ou sur
 * du vide, avec des entrées sans rapport avec ce qu'on visait.
 *
 * Règle retenue : **le clic droit n'a de sens que sur une cible**. Un composant qui a un
 * menu métier le sert (il consomme l'événement) ; partout ailleurs il ne se passe rien,
 * et le menu natif reste bloqué. Trois exceptions, dans cet ordre :
 *   1. l'événement a déjà été traité (menu Radix, viewer 3D qui orbite) — on n'y touche pas ;
 *   2. Shift+clic droit rend la main au navigateur (convention Figma/Maps, dépannage) ;
 *   3. les zones de saisie gardent le natif — sans quoi coller dans un commentaire devient
 *      pénible, et le correcteur orthographique inatteignable.
 */

/** Zones où le menu natif reste roi (édition de texte). */
export const NATIVE_ZONES =
  'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]';

export interface ContextMenuSituation {
  /** Un composant a déjà servi son propre menu. */
  defaultPrevented: boolean;
  /** Shift enfoncé : échappatoire vers le menu du navigateur. */
  shiftKey: boolean;
  /** La cible est un champ de saisie ou une zone éditable. */
  inNativeZone: boolean;
}

/** Faut-il empêcher le menu natif du navigateur de s'ouvrir ? */
export function shouldBlockNativeMenu({
  defaultPrevented,
  shiftKey,
  inNativeZone,
}: ContextMenuSituation): boolean {
  if (defaultPrevented) return false;
  if (shiftKey) return false;
  if (inNativeZone) return false;
  return true;
}

/** Lit la situation depuis un événement réel. */
export function situationOf(event: MouseEvent): ContextMenuSituation {
  const target = event.target as Element | null;
  return {
    defaultPrevented: event.defaultPrevented,
    shiftKey: event.shiftKey,
    inNativeZone: Boolean(target?.closest?.(NATIVE_ZONES)),
  };
}
