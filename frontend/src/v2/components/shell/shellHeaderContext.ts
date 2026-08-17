// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext } from 'react';

/**
 * Nœud d'accueil du titre / fil d'Ariane dans la barre du haut (A1).
 *
 * Depuis que `Shell` est une route layout, il est monté une fois pour toutes et les pages
 * vivent dans son `<Outlet/>` : elles ne peuvent plus lui passer leur titre en prop. Elles
 * le projettent donc par portail dans ce nœud, via `PageShell`. Vaut `null` le temps du
 * premier rendu (le nœud n'existe pas encore) — les consommateurs ne rendent alors rien.
 */
export const ShellHeaderContext = createContext<HTMLElement | null>(null);
