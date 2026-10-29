// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useT } from '../i18n';

/**
 * "Done — undo?": the confirmation of a SERVER write, with the gesture that undoes it attached to the toast.
 *
 * Why not Ctrl+Z. Changing a status, assigning a task, reordering a playlist are
 * shared mutations: sent to the server, they are already with everyone else, and a
 * ShotGrid engine may have arbitrated behind them. A Ctrl+Z would suggest a local stack we do not
 * hold — we can only promise the **previous** move, and only because we know its
 * prior value. That is exactly what the toast offers: one step, named, visible, within
 * immediate reach, and it disappears with it rather than suggesting a history.
 *
 * Undoing is a write like any other: it can fail (rights, ShotGrid arbitration,
 * network). It then says so, instead of letting the screen lie about the real state.
 */

/** The toast stays longer than usual: four seconds are not enough to read it back. */
const UNDO_TOAST_MS = 8000;

export interface UndoToast {
  /**
   * Announces success, with "Undo" if the inverse is known.
   *
   * `undo` redoes a server write and returns its promise: that decides the second
   * message. If omitted, the toast is a plain success — the case for actions without a tracked inverse.
   */
  done: (message: string, undo?: () => Promise<unknown>) => void;
}

export function useUndoToast(): UndoToast {
  const t = useT();

  const done = useCallback(
    (message: string, undo?: () => Promise<unknown>) => {
      if (!undo) {
        toast.success(message);
        return;
      }
      // Single pass: sonner closes the toast on click, but a quick double-click on
      // the action would replay the inverse — here, it would reset a status already reset.
      let spent = false;
      const id = toast.success(message, {
        duration: UNDO_TOAST_MS,
        action: {
          label: t('common.undo'),
          onClick: () => {
            if (spent) return;
            spent = true;
            toast.dismiss(id);
            void undo().then(
              () => toast.success(t('common.undone')),
              (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.undoFailed')),
            );
          },
        },
      });
    },
    [t],
  );

  return { done };
}
