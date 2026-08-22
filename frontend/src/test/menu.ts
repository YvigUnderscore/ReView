// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen } from '@testing-library/react';

/**
 * Menus contextuels (Radix) dans les tests.
 *
 * L'application met ses actions au clic droit (règle « UI simple ») : les tests doivent
 * donc savoir les atteindre. Deux pièges, tous deux payés une fois ici plutôt qu'à chaque
 * fichier :
 *
 * 1. **`fireEvent.click`, pas `userEvent.click`.** `userEvent` déplace le pointeur avant
 *    de cliquer ; sous happy-dom, ce déplacement fait sortir le curseur du déclencheur de
 *    sous-menu, Radix referme le sous-menu, et le clic tombe dans le vide — silencieusement,
 *    puisque l'élément existe encore dans le DOM au moment de la recherche.
 * 2. Le contenu d'un sous-menu n'existe qu'une fois le sous-menu ouvert : il faut cliquer
 *    le déclencheur avant de chercher ses entrées.
 */

/** Ouvre le menu contextuel attaché à un élément (clic droit). */
export function openContextMenu(target: Element): void {
  fireEvent.contextMenu(target);
}

/** Déplie un sous-menu par son libellé et rend son contenu atteignable. */
export async function openSubmenu(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

/** Déclenche une entrée simple du menu. */
export async function clickMenuItem(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

/** Coche une entrée de groupe radio (statut, tri, mode d'affichage). */
export async function clickMenuRadio(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitemradio', { name: label }));
}
