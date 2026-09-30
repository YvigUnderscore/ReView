// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { hintClasses, type HintSize, type HintTone } from './hint.variants';

/**
 * La phrase sous un réglage — l'aide, l'erreur, la confirmation.
 *
 * La paire `text-xs text-muted-foreground` était recopiée 364 fois, et le cran plus petit
 * 76 fois de plus : aucune primitive ne la portait, si bien que chaque écran redécidait
 * seul de la taille de ses explications. Le résultat se voyait — trois tailles d'aide sur
 * une même colonne de réglages.
 *
 * La distinction que porte ce composant n'est pas décorative, et vit dans
 * `hint.variants.ts` : une note se réduit, un message d'erreur ou de confirmation jamais.
 *
 * ```tsx
 * <Hint>{t('display.view.hint')}</Hint>
 * <Hint size="fine">{t('settings.accentHint')}</Hint>   // note de bas de panneau
 * <Hint tone="error">{error}</Hint>                      // jamais réduit
 * ```
 */
export interface HintProps {
  children: ReactNode;
  /**
   * `note` (défaut) : la ligne d'aide d'un réglage. `fine` : un cran plus petit, pour la
   * note de bas de panneau qui commente le panneau entier plutôt qu'un champ.
   * Sans effet sur les tons `error` et `success`.
   */
  size?: HintSize;
  tone?: HintTone;
  /** Pour relier l'aide à son champ (`aria-describedby`). */
  id?: string;
  className?: string;
}

export function Hint({ children, size = 'note', tone = 'muted', id, className }: HintProps) {
  return (
    <p id={id} className={cn(hintClasses(tone, size), className)}>
      {children}
    </p>
  );
}

export default Hint;
