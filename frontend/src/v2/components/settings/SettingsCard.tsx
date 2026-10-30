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
 * The settings card: a single one, for the three families.
 *
 * There used to be three conventions: `Panel` (grey capitalised title) in administration, `Card` with an `<h2>` in the
 * profile, and `Card` with a `<div>` plus a copied help line in each project section. Three drawings for the same object,
 * on screens one opens one after the other.
 *
 * The card also carries its **colour** and its **search**: the icon dot tints the panel without repainting it, and `keywords`
 * lists the words one searches this setting by: "watermark" for burn-ins, "timezone" for the language.
 */

/** Available tones: all taken from the theme tokens, never from the raw palette. */
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
  /** The panel's intent, in one line. This is not a field's help. */
  hint?: string;
  icon?: LucideIcon;
  tone?: SettingsTone;
  /**
   * Words one searches this setting by, beyond its title, in English **and** in French, like the index of the
   * administration sections. Not displayed.
   */
  keywords?: readonly string[];
  /** Header commands (toggle, add button). */
  actions?: ReactNode;
  /** Panel footer note, one step smaller than the help. */
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
