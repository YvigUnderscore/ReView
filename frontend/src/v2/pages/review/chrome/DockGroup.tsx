// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '@/v2/i18n';

/**
 * Template for the dock's `<Select>`s: the primitive is sized for forms, while the panels are two
 * notches denser. Passed as `className` so that `twMerge` replaces the default padding and text size.
 */
export const DOCK_SELECT = 'w-full px-1.5 py-[0.3125rem] text-xs';

/**
 * Content primitives of the inspector dock. A panel is only a series of `Group`s, and a `Group` a
 * series of `Row`s: label on the left, control on the right. This regularity is what makes panels
 * readable without scanning them — nothing else is composed here.
 *
 * `collapsible` turns the title into a button: the title itself folds the group, not a handle added
 * beside it. `action` stays on the right and outside the button — saving a view or arming the
 * measure cannot live in the collapse trigger.
 */
export function Group({
  title,
  action,
  collapsible,
  defaultCollapsed,
  count,
  children,
}: {
  title: string;
  /** Group header action, pushed to the right (e.g. "save current view"). */
  action?: ReactNode;
  /** Clickable title: the group folds and unfolds. */
  collapsible?: boolean;
  /** Starts collapsed (long group) — the user stays in control afterwards. */
  defaultCollapsed?: boolean;
  /** Count shown next to the title: what the group contains when closed. */
  count?: number;
  children: ReactNode;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(Boolean(collapsible && defaultCollapsed));
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="rv-group">
      <h4 className="rv-group__title">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? t('review.dock.group.expand') : t('review.dock.group.collapse')}
            className="flex min-w-0 flex-1 items-center gap-1 text-left uppercase transition-colors hover:text-foreground"
          >
            <Chevron size={12} className="shrink-0" />
            <span className="truncate">{title}</span>
            {count !== undefined && <span className="shrink-0 font-mono normal-case">{count}</span>}
          </button>
        ) : (
          title
        )}
        {action && <span className="ml-auto">{action}</span>}
      </h4>
      {!collapsed && children}
    </section>
  );
}

export function Row({
  label,
  hint,
  stack,
  children,
}: {
  label: ReactNode;
  hint?: string;
  /** Wide control (select, segmented control): the label goes above it. */
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={stack ? 'rv-row rv-row--stack' : 'rv-row'} title={hint}>
      <span className="rv-row__label">{label}</span>
      {children}
    </div>
  );
}

/** Read-only row: a label, a numeric value — statistics, spec sheet. */
export function ReadRow({ label, value, stack }: { label: string; value: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'rv-row rv-row--stack' : 'rv-row'}>
      <span className="rv-row__label">{label}</span>
      <span className={stack ? 'text-xs' : 'font-mono text-xs'}>{value}</span>
    </div>
  );
}
