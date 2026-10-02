// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type DragEvent } from 'react';
import { filesFromDataTransfer } from '../../lib/dropEntries';

/**
 * Cible de dépôt de fichiers (Phase 46).
 *
 * Déposer est le geste naturel pour livrer un travail ; l'application le réservait à une
 * zone unique, obligeant à créer la version, puis à viser le bouton d'upload, puis à
 * traverser un sélecteur de fichiers. Ce hook rend n'importe quel élément déposable, pour
 * que chaque version soit sa propre cible.
 *
 * Un dossier déposé est déplié : c'est ainsi qu'arrive un plan livré en séquence d'images,
 * et `dataTransfer.files` seul l'aurait ignoré sans un mot.
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
        // Les entrées se lisent pendant l'événement : l'appel part donc avant tout `await`.
        void filesFromDataTransfer(e.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      },
    },
  };
}
