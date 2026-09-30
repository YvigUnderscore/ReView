// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { shouldBlockNativeMenu, situationOf } from '../lib/contextTarget';

/**
 * Gardien du clic droit (A3) — remplace l'ancien menu global.
 *
 * Ce composant ne rend rien : il empêche seulement le menu du navigateur d'apparaître là
 * où l'application n'a rien de pertinent à proposer. Le menu générique qui s'ouvrait
 * partout a été retiré : il servait les mêmes entrées sur une carte de plan, sur un titre
 * et sur du vide, ce qui n'aidait personne. Les actions qu'il portait encore (copier le
 * lien de la page, rafraîchir, thème, raccourcis) ont rejoint la palette Ctrl+K, où elles
 * sont cherchables et accessibles au clavier.
 *
 * La politique elle-même vit dans `lib/contextTarget.ts`, testée isolément.
 */
export default function ContextMenuGuard() {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (shouldBlockNativeMenu(situationOf(event))) event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);
  return null;
}
