import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Raccourcis clavier globaux (10.A3) : séquence « g » puis touche (g p → projets,
 * g k → kanban, g b → board du projet courant) et « ? » → panneau d'aide.
 * Inactifs dans les champs de saisie et quand un dialog est ouvert
 * (Ctrl+K vit dans CommandPalette, qui doit primer partout).
 */

export const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function useGlobalShortcuts({ projectId, onHelp }: { projectId: number | null; onHelp: () => void }) {
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
        if (key === 'p') {
          e.preventDefault();
          navigate('/');
        } else if (key === 'k' && projectId !== null) {
          e.preventDefault();
          navigate(`/projects/${projectId}/kanban`);
        } else if (key === 'b' && projectId !== null) {
          e.preventDefault();
          navigate(`/projects/${projectId}/board`);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = true;
        timer.current = window.setTimeout(() => {
          pendingG.current = false;
        }, 1000);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        onHelp();
      }
    };
    document.addEventListener('keydown', down);
    return () => {
      document.removeEventListener('keydown', down);
      window.clearTimeout(timer.current);
    };
  }, [navigate, projectId, onHelp]);
}
