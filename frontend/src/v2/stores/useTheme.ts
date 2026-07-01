import { create } from 'zustand';

/**
 * Thème clair/sombre — sombre par défaut (usage studio).
 * Applique la classe `dark` sur <html> dès l'import du module (avant le premier rendu)
 * pour éviter un flash clair au chargement.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'review:theme';

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

const stored = localStorage.getItem(STORAGE_KEY);
const initial: Theme = stored === 'light' ? 'light' : 'dark';
applyTheme(initial);

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set) => ({
  theme: initial,
  toggle: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return { theme: next };
    }),
}));
