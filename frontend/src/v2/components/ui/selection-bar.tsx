// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { useT } from '../../i18n';

export interface SelectionAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/**
 * Floating bulk-actions bar (13.A). Appears at the bottom of the screen as soon as at least
 * one item is selected; the actions (Delete / Status / Move…) are supplied by the page.
 * "Cancel" clears the selection.
 *
 * Appearance and removal are CSS `@keyframes` since framer-motion was dropped from the first
 * load (F3): the bar stays mounted for the duration of its slide-down, otherwise it would vanish
 * at once where `AnimatePresence` used to slide it out at the bottom.
 */

/** Removal duration, mirroring exactly the animation class below (0.18 s). */
const EXIT_MS = 180;
export default function SelectionBar({
  count,
  actions,
  onClear,
  label,
}: {
  count: number;
  actions: SelectionAction[];
  onClear: () => void;
  /** Noun agreement for the number, without the number: the bar composes "3" + "projects". */
  label?: string;
}) {
  const t = useT();
  const [phase, setPhase] = useState<'absent' | 'in' | 'out'>(count > 0 ? 'in' : 'absent');
  // Count and label of the last non-empty selection: on the last frame of the removal, the
  // page has already reset the count to zero and the bar would announce "0 selected".
  const [frozen, setFrozen] = useState({ count, label });
  const [seenCount, setSeenCount] = useState(count);

  if (count > 0 && (frozen.count !== count || frozen.label !== label)) setFrozen({ count, label });
  if (seenCount !== count) {
    // Adjusted during render (same pattern as the shell): no intermediate frame in the wrong
    // state, and no `setState` in an effect.
    setSeenCount(count);
    if (count > 0) setPhase('in');
    else if (phase !== 'absent') setPhase('out');
  }

  useEffect(() => {
    if (phase !== 'out') return;
    const id = setTimeout(() => setPhase('absent'), EXIT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  if (phase === 'absent') return null;

  const shownCount = count > 0 ? count : frozen.count;
  const shownLabel = count > 0 ? label : frozen.label;
  // 24 px of travel and 0.18 s: the very values of the original animation.
  const move =
    phase === 'out'
      ? 'animate-out fade-out slide-out-to-bottom-6 fill-mode-forwards duration-[180ms] motion-reduce:animate-none'
      : 'animate-in fade-in slide-in-from-bottom-6 duration-[180ms] motion-reduce:animate-none';

  return (
    <div className={`pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 ${move}`}>
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur">
        <span className="text-sm font-medium">
          <span className="text-primary">{shownCount}</span> {shownLabel ?? t('common.selected')}
        </span>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-1">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.danger ? 'destructive' : 'outline'}
              onClick={a.onClick}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
          <button
            onClick={onClear}
            title={t('common.clearSelection')}
            aria-label={t('common.clearSelection')}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
