// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import {
  clampSettings,
  DEFAULT_COLOR_SETTINGS,
  readStoredSettings,
  writeStoredSettings,
  type ColorSettings,
} from './colorSettings';

/**
 * État vivant de la transformée d'affichage. Le panneau Color (dock) et le viewer image
 * vivent dans deux sous-arbres différents : passer les réglages par les props traverserait
 * `MediaChrome` de part en part. Un store, comme les guides de composition.
 *
 * La préférence est **locale au navigateur** : elle suit le lecteur d'un média à l'autre et
 * n'est jamais envoyée au serveur — la transformée est une aide à la lecture, pas une note.
 */
interface ColorGradeState {
  settings: ColorSettings;
  /**
   * Faux dès qu'un rendu a échoué faute de WebGL. Le viewer est le seul à s'en apercevoir,
   * le panneau est le seul à pouvoir le dire : le store fait le lien. Volontairement **non
   * persisté** — un autre navigateur, une autre réponse.
   */
  supported: boolean;
  set: (patch: Partial<ColorSettings>) => void;
  markUnsupported: () => void;
  reset: () => void;
}

export const useColorGrade = create<ColorGradeState>((set) => ({
  settings: readStoredSettings(),
  supported: true,
  set: (patch) =>
    set((s) => {
      const settings = clampSettings({ ...s.settings, ...patch });
      writeStoredSettings(settings);
      return { settings };
    }),
  markUnsupported: () => set({ supported: false }),
  reset: () => {
    const settings = { ...DEFAULT_COLOR_SETTINGS };
    writeStoredSettings(settings);
    set({ settings, supported: true });
  },
}));
