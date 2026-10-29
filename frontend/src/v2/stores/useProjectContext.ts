// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * "Current" project inferred from the page context (resolved by EntityBreadcrumb).
 * Lets the sidebar show the project tree even on routes that do not carry the projectId
 * (/tasks/:id, /assets/:id, /review/:mediaId).
 */
interface ProjectContextState {
  projectId: number | null;
  setProjectId: (id: number | null) => void;
}

export const useProjectContext = create<ProjectContextState>((set) => ({
  projectId: null,
  setProjectId: (projectId) => set({ projectId }),
}));
