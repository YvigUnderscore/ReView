// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { hintClasses, type HintSize, type HintTone } from './hint.variants';

/**
 * The sentence under a setting: help, error or confirmation.
 *
 * The pair `text-xs text-muted-foreground` was copied 364 times, and the smaller step 76
 * more: no primitive carried it, so each screen decided the size of its explanations on
 * its own. The result was visible — three help sizes in one settings column.
 *
 * The distinction this component carries is not decorative, and lives in
 * `hint.variants.ts`: a note shrinks, an error or confirmation never does.
 *
 * ```tsx
 * <Hint>{t('display.view.hint')}</Hint>
 * <Hint size="fine">{t('settings.accentHint')}</Hint>   // panel footnote
 * <Hint tone="error">{error}</Hint>                      // never shrunk
 * ```
 */
export interface HintProps {
  children: ReactNode;
  /**
   * `note` (default): the help line of a setting. `fine`: one step smaller, for the panel
   * footnote that comments on the whole panel rather than a field.
   * No effect on the `error` and `success` tones.
   */
  size?: HintSize;
  tone?: HintTone;
  /** Links the help to its field (`aria-describedby`). */
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
