import { create } from 'zustand';

/**
 * Guides de composition du viewer (34.G) : règle des tiers, croix centrale, safe areas
 * action (90 %) et titre (80 %). Préférence locale au navigateur (localStorage), activée
 * par le menu clic droit de la review — s'applique au cadre du média affiché.
 */
export type GuideKey = 'thirds' | 'center' | 'actionSafe' | 'titleSafe';

const STORAGE_KEY = 'review:guides';

const read = (): Record<GuideKey, boolean> => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<GuideKey, boolean>>;
    return {
      thirds: !!raw.thirds,
      center: !!raw.center,
      actionSafe: !!raw.actionSafe,
      titleSafe: !!raw.titleSafe,
    };
  } catch {
    return { thirds: false, center: false, actionSafe: false, titleSafe: false };
  }
};

interface GuidesState {
  guides: Record<GuideKey, boolean>;
  toggle: (key: GuideKey) => void;
}

export const useGuides = create<GuidesState>((set) => ({
  guides: read(),
  toggle: (key) =>
    set((s) => {
      const guides = { ...s.guides, [key]: !s.guides[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(guides));
      return { guides };
    }),
}));
