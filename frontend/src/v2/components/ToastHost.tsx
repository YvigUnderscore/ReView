// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Toaster } from 'sonner';
import type { Theme } from '../stores/useTheme';

/**
 * Hauteur libérée au-dessus du premier toast : la barre du haut mesure `h-14` (3,5 rem) et
 * on lui laisse une gouttière. Exportée parce que c'est la seule chose à vérifier — un toast
 * qui démarre plus haut recouvrirait la recherche, la cloche et le suivi des envois.
 */
export const TOAST_TOP_OFFSET = '4.25rem';

/**
 * Les toasts de l'application, **en haut et au centre**.
 *
 * Ils tombaient en bas à droite, où ils recouvraient ce que le coin contenait déjà : le
 * suivi des envois, la conversation ancrée, la pagination des listes, le HUD du viewer. Deux
 * emplacements hauts étaient possibles, et le choix n'est pas indifférent :
 *
 * - `top-right` place une pile de 356 px de large sous le bout droit de la rangée — c'est-à-dire
 *   exactement sous la recherche, la cloche et le suivi des envois, les trois surfaces qu'on
 *   vient d'y installer. On remplacerait un recouvrement par un autre.
 * - `top-center` tombe sous le milieu de la rangée, que le fil d'Ariane (aligné à gauche)
 *   laisse libre, et loin du groupe de droite.
 *
 * D'où `top-center`, décalé de {@link TOAST_TOP_OFFSET} pour passer SOUS la barre du haut
 * plutôt que par-dessus : le décalage par défaut de sonner (24 px) l'aurait posé en plein
 * milieu d'une barre haute de 56 px. Le même décalage vaut en fenêtre téléphone
 * (`mobileOffset`), où la pile occupe toute la largeur.
 */
export default function ToastHost({ theme }: { theme: Theme }) {
  return (
    <Toaster
      position="top-center"
      offset={{ top: TOAST_TOP_OFFSET }}
      mobileOffset={{ top: TOAST_TOP_OFFSET }}
      richColors
      closeButton
      theme={theme}
    />
  );
}
