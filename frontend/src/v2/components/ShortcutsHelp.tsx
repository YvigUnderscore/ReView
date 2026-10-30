// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import { useT, type MessageKey } from '../i18n';
import {
  GLOBAL_SHORTCUTS,
  isValidKey,
  resolveBindings,
  type ShortcutDef,
  type ShortcutId,
} from '../lib/shortcutRegistry';
import { reviewShortcutGroups, type KeyToken } from '../pages/review/chrome/shortcuts';

/**
 * Summary panel of keyboard shortcuts (10.A3), opened with `?`.
 *
 * Nothing is written by hand here. The "Navigation" section comes from `lib/shortcutRegistry` and
 * remains **editable**: clicking a key captures the next keystroke and persists the override
 * (42.A2). The review sections come from `pages/review/chrome/shortcuts`, the registry that
 * the handlers themselves consult. That is what prevents the help and the code from diverging,
 * as they had: ten active shortcuts were missing from the roll call, an inert "Zoom" tool
 * appeared there, and the key names were hard-coded in French, hence displayed in
 * French in the other thirteen languages.
 */

/** Label of a key: technical character as is, key name translated. */
const keyLabel = (token: KeyToken, t: (key: MessageKey) => string): string =>
  'char' in token ? token.char : t(token.nameKey);

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-xs font-medium"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Keyboard representation of a resolved global shortcut (explicit `g` leader). */
function displayKeys(def: ShortcutDef, key: string): string[] {
  const label = key === '?' ? '?' : key.toUpperCase();
  return def.kind === 'leader-g' ? ['G', label] : [label];
}

/** Editable "Navigation" section: each key is reconfigurable (persisted per account). */
function NavShortcuts() {
  const t = useT();
  const prefsQ = usePreferences();
  const update = useUpdatePreferences();
  const shortcuts = prefsQ.data?.shortcuts;
  const overrides = useMemo(() => shortcuts ?? {}, [shortcuts]);
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const def = GLOBAL_SHORTCUTS.find((s) => s.id === capturing)!;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      const key = e.key.toLowerCase();
      if (!isValidKey(key)) {
        toast.error(t('shortcuts.invalid'));
        return;
      }
      const conflict = GLOBAL_SHORTCUTS.some(
        (s) => s.id !== capturing && s.kind === def.kind && bindings[s.id] === key,
      );
      if (conflict) {
        toast.error(t('shortcuts.taken'));
        return;
      }
      const next = { ...overrides };
      if (key === def.defaultKey) delete next[capturing];
      else next[capturing] = key;
      update.mutate({ shortcuts: next }, { onSuccess: () => toast.success(t('shortcuts.updated')) });
      setCapturing(null);
    };
    // Capture phase: take precedence over Radix (Escape does not close the dialog during capture).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, overrides, bindings, update, t]);

  const reset = (id: ShortcutId) => {
    const next = { ...overrides };
    delete next[id];
    update.mutate({ shortcuts: next });
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold section-label text-muted-foreground">{t('shortcuts.nav')}</p>
      <p className="mb-2 text-xs text-muted-foreground">{t('shortcuts.hint')}</p>
      <ul className="space-y-1.5">
        <li className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('shortcuts.search')}</span>
          <Keys keys={['Ctrl', 'K']} />
        </li>
        {GLOBAL_SHORTCUTS.map((def) => {
          const isCapturing = capturing === def.id;
          const custom = isValidKey(overrides[def.id] ?? '') && overrides[def.id] !== def.defaultKey;
          return (
            <li key={def.id} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{t(def.labelKey)}</span>
              <span className="flex items-center gap-2">
                {isCapturing ? (
                  <span className="text-xs font-medium text-primary">{t('shortcuts.press')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCapturing(def.id)}
                    className="rounded hover:opacity-80"
                    title={t('shortcuts.clickToChange')}
                  >
                    <Keys keys={displayKeys(def, bindings[def.id])} />
                  </button>
                )}
                {custom && !isCapturing && (
                  <button
                    type="button"
                    onClick={() => reset(def.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title={t('shortcuts.reset')}
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + scroll : la liste des raccourcis ne doit jamais déborder de l'écran. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <NavShortcuts />
          {reviewShortcutGroups().map((g) => (
            <div key={g.titleKey}>
              <p className="mb-2 text-xs font-semibold section-label text-muted-foreground">
                {t(g.titleKey)}
              </p>
              <ul className="space-y-1.5">
                {g.shortcuts.map((s) => (
                  <li key={s.labelKey} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{t(s.labelKey)}</span>
                    <Keys keys={s.keys.map((token) => keyLabel(token, t))} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
