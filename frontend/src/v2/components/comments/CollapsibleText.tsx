// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { isLongText, plainLength } from './collapse';
import { useT } from '../../i18n';

/**
 * Un contenu long s'ouvre replié (D6) et se déplie au clic.
 *
 * Le texte entier reste DANS le document : on le masque en hauteur, jamais en le tronquant.
 * Un Ctrl+F, un lecteur d'écran et une recherche du navigateur continuent donc de le
 * trouver, replié ou non — et l'indicateur dit ce qu'il cache.
 */
export default function CollapsibleText({ text, children }: { text: string; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const collapsed = isLongText(text) && !open;

  return (
    <div>
      <div className={collapsed ? 'max-h-32 overflow-hidden' : undefined}>{children}</div>
      {isLongText(text) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {collapsed
            ? t('comments.expandComment', { count: plainLength(text) })
            : t('comments.collapseComment')}
        </button>
      )}
    </div>
  );
}
