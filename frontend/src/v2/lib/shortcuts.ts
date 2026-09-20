// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ShortcutId } from './shortcutRegistry';

/**
 * Raccourcis clavier globaux (10.A3, reconfigurables 42.A2) : séquence « g » puis touche
 * (défauts g p → projets, g k → kanban, g b → board du projet courant) et « ? » → aide.
 * Les touches actives viennent du registre résolu (`bindings`, surcharges compte incluses).
 * Inactifs dans les champs de saisie et quand un dialog est ouvert
 * (Ctrl+K vit dans CommandPalette, qui doit primer partout).
 *
 * La séquence **consomme ses deux frappes** (`stopPropagation`). Ce gestionnaire est posé sur
 * `document`, le rail d'outils de la review sur `window` : la remontée traverse le premier
 * avant le second, et sans cela une même frappe faisait deux choses. `g` armait l'outil
 * polygone *et* amorçait la séquence ; la frappe suivante quittait la page — annotation en
 * cours perdue. Le leader `g` n'étant pas reconfigurable, c'est lui qui garde la main, et la
 * lettre de l'outil a été déplacée (`chrome/tools.ts`).
 */

/** Types d'input qui ne saisissent pas de texte : le focus dessus ne bloque pas les raccourcis. */
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
        // Seconde frappe de la séquence : elle appartient à la séquence, aboutie ou non. La
        // laisser filer armait un outil du rail au passage (`g b` armait la sélection
        // rectangle d'un splat en même temps qu'il ouvrait le board).
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
