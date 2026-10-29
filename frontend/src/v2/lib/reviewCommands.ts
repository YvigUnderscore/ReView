// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Registry of contextual review commands for the Ctrl+K palette (B3): the mounted viewer publishes its
 * actions (frame, set a key, orbit preset…), the palette displays them in a dedicated group — in line
 * with the "simple UI" rule: one more action is not one more button.
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

/** Publishes the commands of the mounted viewer; cleared on unmount. */
export function useRegisterReviewCommands(commands: ReviewCommand[]): void {
  const setCommands = useReviewCommands((s) => s.setCommands);
  useEffect(() => {
    setCommands(commands);
    return () => setCommands([]);
  }, [commands, setCommands]);
}
