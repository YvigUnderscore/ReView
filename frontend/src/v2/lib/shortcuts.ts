// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ShortcutId } from './shortcutRegistry';

/**
 * Global keyboard shortcuts (10.A3, reconfigurable 42.A2): a "g" sequence then a key
 * (defaults g p → projects, g k → kanban, g b → board of the current project) and "?" → help.
 * The active keys come from the resolved registry (`bindings`, account overrides included).
 * Inactive in text input fields and while a dialog is open
 * (Ctrl+K lives in CommandPalette, which must take precedence everywhere).
 *
 * The sequence **consumes its two keystrokes** (`stopPropagation`). This handler is set on
 * `document`, the review tool rail on `window`: the event bubbles through the first before the second,
 * and without this a single keystroke did two things. `g` armed the polygon tool *and* started the
 * sequence; the next keystroke left the page — an annotation in progress was lost. The `g` leader not
 * being reconfigurable, it is the one that keeps control, and the tool's letter was moved (`chrome/tools.ts`).
 */

/** Input types that do not take text: focus on them does not block shortcuts. */
const NON_TEXT_INPUT = /^(checkbox|radio|button|submit|reset|range|color|file)$/;

export const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT.test(el.type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

export function useGlobalShortcuts({
  projectId,
  onHelp,
  bindings,
}: {
  projectId: number | null;
  onHelp: () => void;
  bindings: Record<ShortcutId, string>;
}) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      if (pendingG.current) {
        pendingG.current = false;
        window.clearTimeout(timer.current);
        // Second keystroke of the sequence: it belongs to the sequence, successful or not. Letting it
        // through would arm a rail tool in passing (`g b` armed the rectangle selection of a splat
        // at the same time as it opened the board).
        e.stopPropagation();
        if (key === bindings['nav.projects']) {
          e.preventDefault();
          void navigate('/projects');
        } else if (key === bindings['nav.kanban'] && projectId !== null) {
          e.preventDefault();
          void navigate(`/projects/${projectId}/kanban`);
        } else if (key === bindings['nav.board'] && projectId !== null) {
          e.preventDefault();
          void navigate(`/projects/${projectId}/board`);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = true;
        e.stopPropagation();
        timer.current = window.setTimeout(() => {
          pendingG.current = false;
        }, 1000);
        return;
      }
      if (e.key === bindings.help) {
        e.preventDefault();
        onHelp();
      }
    };
    document.addEventListener('keydown', down);
    return () => {
      document.removeEventListener('keydown', down);
      window.clearTimeout(timer.current);
    };
  }, [navigate, projectId, onHelp, bindings]);
}
