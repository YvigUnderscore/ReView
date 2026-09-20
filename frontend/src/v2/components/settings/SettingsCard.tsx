// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '../ui/card';
import { Hint } from '../ui/hint';
import { cn } from '../../lib/utils';
import { haystack, matchesQuery } from './settingsFilter';
import { useSettingsSearch } from './settingsSearchContext';

/**
 * La carte de réglages — une seule, pour les trois familles.
 *
 * Il en existait trois conventions : `Panel` (titre en capitales grises) dans
 * l'administration, `Card` + `<h2 class="text-sm font-semibold">` dans le profil, et
 * `Card` + `<div class="text-sm font-medium">` + une ligne d'aide recopiée dans chaque
 * section de projet. Trois dessins pour un même objet, sur des écrans qu'on ouvre l'un
 * après l'autre.
 *
 * La carte porte aussi sa **couleur** et sa **recherche** : la pastille d'icône teinte le
 * panneau sans le repeindre, et `keywords` dit les mots par lesquels on vient chercher ce
 * réglage — « filigrane » pour les burn-ins, « fuseau » pour la langue.
 */

/** Tons disponibles — tous pris dans les tokens du thème, jamais dans la palette brute. */
export const SETTINGS_TONES = {
  neutral: { chip: 'bg-secondary text-muted-foreground', rail: 'border-l-border' },
  primary: { chip: 'bg-primary/10 text-primary', rail: 'border-l-primary/50' },
  accent: { chip: 'bg-accent2/10 text-accent2', rail: 'border-l-accent2/50' },
  success: { chip: 'bg-success/10 text-success', rail: 'border-l-success/50' },
  warning: { chip: 'bg-warning/10 text-warning', rail: 'border-l-warning/50' },
  info: { chip: 'bg-info/10 text-info', rail: 'border-l-info/50' },
  danger: { chip: 'bg-destructive/10 text-destructive', rail: 'border-l-destructive/50' },
} as const;

export type SettingsTone = keyof typeof SETTINGS_TONES;

export interface SettingsCardProps {
  title: string;
  /** L'intention du panneau, en une ligne. Ce n'est pas l'aide d'un champ. */
  hint?: string;
  icon?: LucideIcon;
  tone?: SettingsTone;
  /**
   * Mots par lesquels on cherche ce réglage, au-delà de son titre — en anglais **et** en
   * français, comme l'index des sections d'administration. Non affichés.
   */
  keywords?: readonly string[];
  /** Commandes de l'en-tête (bascule, bouton d'ajout). */
  actions?: ReactNode;
  /** Note de bas de panneau, un cran plus petite que l'aide. */
  footnote?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsCard({
  title,
  hint,
  icon: Icon,
  tone = 'neutral',
  keywords,
  actions,
  footnote,
  children,
  className,
}: SettingsCardProps) {
  const id = useId();
  const { query, report } = useSettingsSearch();
  const hay = useMemo(
    () => haystack([title, hint, footnote, ...(keywords ?? [])]),
    [title, hint, footnote, keywords],
  );
  const visible = matchesQuery(hay, query);

  useEffect(() => {
    report(id, visible);
    return () => report(id, false);
  }, [id, visible, report]);

  if (!visible) return null;
  const palette = SETTINGS_TONES[tone];
  return (
    <Card className={cn('space-y-3 border-l-2', palette.rail, className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span
              className={cn(
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                palette.chip,
              )}
            >
              <Icon size={15} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{title}</h3>
            {hint && <Hint className="mt-0.5">{hint}</Hint>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
      {footnote && <Hint size="fine">{footnote}</Hint>}
    </Card>
  );
}

export default SettingsCard;
