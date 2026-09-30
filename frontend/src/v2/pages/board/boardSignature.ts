// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoardFiles } from './boardFiles';

/**
 * Empreinte d'une scène de board — ce qui permet de savoir si elle a **réellement** changé.
 *
 * Excalidraw rappelle `onChange` bien au-delà des vraies modifications : déplacement du
 * curseur, défilement, sélection, et tout rendu provoqué par le composant parent. L'autosave
 * comparait l'instantané en attente à celui qu'elle venait d'écrire **par identité d'objet**
 * (`pendingRef.current === snapshot`) ; or `onChange` reconstruit un objet neuf à chaque
 * appel, donc l'égalité n'était jamais vraie. L'instantané n'était jamais purgé, l'indicateur
 * « enregistrement… » ne s'éteignait jamais, et un board simplement **ouvert** réécrivait sa
 * ligne en base toutes les ~1,2 s — indéfiniment, et pour chaque onglet ouvert du studio.
 *
 * L'empreinte s'appuie sur le compteur `version` qu'Excalidraw incrémente à chaque mutation
 * réelle d'un élément : deux scènes identiques donnent la même chaîne, et la comparer coûte
 * infiniment moins qu'une sérialisation complète du document.
 *
 * Les images sont réduites à leurs identifiants : le contenu d'un fichier ne change jamais
 * sous un identifiant donné, et la forme d'exécution (dataURL) diffère de la forme
 * enregistrée (déposée dans MinIO) — les comparer ferait diverger l'empreinte pour rien.
 */
export function sceneSignature(elements: readonly unknown[], files: BoardFiles): string {
  const parts: string[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      // Forme inattendue : on retombe sur le contenu, quitte à payer la sérialisation.
      parts.push(JSON.stringify(element));
      continue;
    }
    const { id, version, versionNonce, isDeleted } = element as {
      id?: unknown;
      version?: unknown;
      versionNonce?: unknown;
      isDeleted?: unknown;
    };
    if (typeof id !== 'string' || typeof version !== 'number') {
      parts.push(JSON.stringify(element));
      continue;
    }
    // `versionNonce` départage deux éditions concurrentes arrivées au même numéro de version.
    parts.push(
      `${id}:${version}:${typeof versionNonce === 'number' ? versionNonce : 0}:${isDeleted ? 1 : 0}`,
    );
  }
  // Les identifiants de fichiers sont triés : l'ordre des clés d'un objet ne fait pas sens.
  const fileIds = Object.keys(files ?? {}).sort();
  return `${parts.join('|')}#${fileIds.join(',')}`;
}
