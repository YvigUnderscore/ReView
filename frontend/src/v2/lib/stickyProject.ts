// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * Projet « courant » de la barre latérale, même hors d'une page de projet (C1).
 *
 * La route seule ne suffit pas : passer par l'accueil, la liste des projets ou les reviews
 * remettait `currentProjectId` à null, et les sections du projet disparaissaient de la
 * barre — il fallait rouvrir le projet pour les retrouver. Le dernier projet ouvert reste
 * donc affiché tant qu'on n'en ouvre pas un autre, et survit au rechargement.
 */

const STORAGE_KEY = 'review:last-project';

/** Quel projet montrer : celui de la route, sinon le dernier connu. Fonction pure, testée. */
export function pickStickyProject(current: number | null, stored: number | null): number | null {
  return current ?? stored;
}

/** Lit l'identifiant mémorisé, en ignorant toute valeur qui n'est pas un id plausible. */
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
      return null; // stockage indisponible (navigation privée, quota)
    }
  });

  // Ajusté pendant le rendu plutôt que dans un effet : React relance immédiatement, sans
  // rendu intermédiaire où la barre latérale montrerait l'ancien projet.
  if (currentProjectId !== null && currentProjectId !== stored) setStored(currentProjectId);

  useEffect(() => {
    if (currentProjectId === null) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(currentProjectId));
    } catch {
      /* stockage indisponible */
    }
  }, [currentProjectId]);

  return pickStickyProject(currentProjectId, stored);
}
