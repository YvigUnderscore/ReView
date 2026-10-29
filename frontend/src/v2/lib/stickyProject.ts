// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * The "current" project of the sidebar, even outside a project page (C1).
 *
 * The route alone is not enough: going through the home page, the project list or the reviews set
 * `currentProjectId` back to null, and the project's sections disappeared from the sidebar — the project
 * had to be reopened to find them again. The last project opened therefore stays displayed until another
 * one is opened, and survives a reload.
 */

const STORAGE_KEY = 'review:last-project';

/** Which project to show: the route's, otherwise the last known one. Pure function, tested. */
export function pickStickyProject(current: number | null, stored: number | null): number | null {
  return current ?? stored;
}

/** Reads the remembered identifier, ignoring any value that is not a plausible id. */
export function readStoredProject(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function useStickyProjectId(currentProjectId: number | null): number | null {
  const [stored, setStored] = useState<number | null>(() => {
    try {
      return readStoredProject(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null; // storage unavailable (private browsing, quota)
    }
  });

  // Adjusted during render rather than in an effect: React re-runs immediately, without an
  // intermediate render where the sidebar would show the old project.
  if (currentProjectId !== null && currentProjectId !== stored) setStored(currentProjectId);

  useEffect(() => {
    if (currentProjectId === null) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(currentProjectId));
    } catch {
      /* storage unavailable */
    }
  }, [currentProjectId]);

  return pickStickyProject(currentProjectId, stored);
}
