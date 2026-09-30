// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Projet « courant » déduit du contexte de la page (résolu par EntityBreadcrumb).
 * Permet à la sidebar d'afficher l'arbre du projet même sur les routes qui ne
 * portent pas le projectId (/tasks/:id, /assets/:id, /review/:mediaId).
 */
interface ProjectContextState {
  projectId: number | null;
  setProjectId: (id: number | null) => void;
}

export const useProjectContext = create<ProjectContextState>((set) => ({
  projectId: null,
  setProjectId: (projectId) => set({ projectId }),
}));
