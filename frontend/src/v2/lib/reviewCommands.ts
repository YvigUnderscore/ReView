// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Registre des commandes contextuelles de review pour la palette Ctrl+K (B3) : le viewer monté
 * publie ses actions (cadrer, poser une clé, preset orbite…), la palette les affiche dans un
 * groupe dédié — conforme à la règle « UI simple » : une action de plus n'est pas un bouton de
 * plus.
 */
export interface ReviewCommand {
  id: string;
  label: string;
  run: () => void;
}

interface ReviewCommandsState {
  commands: ReviewCommand[];
  setCommands: (commands: ReviewCommand[]) => void;
}

export const useReviewCommands = create<ReviewCommandsState>()((set) => ({
  commands: [],
  setCommands: (commands) => set({ commands }),
}));

/** Publie les commandes du viewer monté ; vidées au démontage. */
export function useRegisterReviewCommands(commands: ReviewCommand[]): void {
  const setCommands = useReviewCommands((s) => s.setCommands);
  useEffect(() => {
    setCommands(commands);
    return () => setCommands([]);
  }, [commands, setCommands]);
}
