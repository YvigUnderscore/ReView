// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type DragEvent } from 'react';

/**
 * Cible de dépôt de fichiers (Phase 46).
 *
 * Déposer est le geste naturel pour livrer un travail ; l'application le réservait à une
 * zone unique, obligeant à créer la version, puis à viser le bouton d'upload, puis à
 * traverser un sélecteur de fichiers. Ce hook rend n'importe quel élément déposable, pour
 * que chaque version soit sa propre cible.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);

  return {
    /** Vrai pendant le survol : à l'appelant d'en faire un retour visuel. */
    over,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        // Sans preventDefault, le navigateur ouvre le fichier à la place de nous le donner.
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        // Un dépôt sur une version ne doit pas remonter à la zone « nouvelle version »
        // qui l'englobe : sans cela, un même fichier partirait deux fois.
        e.stopPropagation();
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}
