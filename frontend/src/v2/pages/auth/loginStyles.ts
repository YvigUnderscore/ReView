// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSSProperties } from 'react';
import type { LoginAppearance } from '../../lib/branding';

/**
 * Styles de l'habillage de connexion — fonctions pures partagées par la page réelle
 * (`AuthLayout`) et l'aperçu de l'admin, pour que ce que l'admin voit soit exactement ce
 * que verront ses utilisateurs.
 */

/** Couche image : fond, cadrage, flou. `null` s'il n'y a pas d'image. */
export function backdropStyle(login: LoginAppearance): CSSProperties | null {
  if (!login.bgUrl) return null;
  return {
    // URL entre guillemets, guillemets internes retirés : une URL présignée porte des
    // paramètres de requête et ne doit pas pouvoir refermer la fonction `url()`.
    backgroundImage: `url("${login.bgUrl.replace(/["\\]/g, '')}")`,
    backgroundSize: login.bgFit,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    // Le flou déborde du cadre : l'échelle évite le liseré transparent sur les bords.
    ...(login.blur > 0 ? { filter: `blur(${login.blur}px)`, transform: 'scale(1.06)' } : {}),
  };
}

/** Voile posé sur l'image pour garder le formulaire lisible. `null` si opacité nulle. */
export function overlayStyle(login: LoginAppearance): CSSProperties | null {
  if (!login.bgUrl || login.overlay <= 0) return null;
  return { backgroundColor: `hsl(var(--background) / ${login.overlay})` };
}
