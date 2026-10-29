// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Composition guides of the viewer (34.G): rule of thirds, centre cross, action (90 %) and title
 * (80 %) safe areas. Browser-local preference (localStorage), enabled from the review's right-click
 * menu — applies to the frame of the displayed media.
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
