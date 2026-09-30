// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Formes d'entrée partagées par les routes qui écrivent une tâche.
 *
 * Deux routeurs créent une tâche — celui des tâches et celui des commentaires, pour un
 * retour de review — et la consigne se borne de la même façon des deux côtés. Deux
 * schémas recopiés auraient divergé au premier ajustement, et le budget de ligne d'un
 * routeur n'est pas l'endroit où décrire une forme de données (même patron que
 * `lib/commentPayload.ts`).
 */

/**
 * Longueur maximale d'une consigne de tâche (Phase 50).
 *
 * De quoi écrire un vrai brief — plusieurs paragraphes — sans laisser coller un fichier
 * entier dans une colonne que la fiche relit à chaque ouverture.
 */
export const TASK_DESCRIPTION_MAX = 4000;

/** Consigne : texte simple, effaçable (`null`), absente = inchangée. */
export const taskDescriptionField = z.string().max(TASK_DESCRIPTION_MAX).nullable().optional();

/**
 * Ce que le dialogue « créer une tâche depuis ce retour » envoie.
 *
 * Le nom est optionnel côté API : un client d'intégration qui n'en fournit pas retombe sur
 * le texte du commentaire, comme avant le dialogue.
 */
export const commentTaskBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: taskDescriptionField,
});
