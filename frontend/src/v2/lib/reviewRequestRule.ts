// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk, queryClient } from './query';
import type { ProjectSettings, ReviewRequestRule } from '../types/api';

/**
 * Ce que le projet exige d'une consigne, et comment l'écran le vérifie AVANT d'écrire.
 *
 * La règle est vérifiée trois fois — par le service, par l'API et ici. Cette troisième
 * vérification n'est pas de la défiance : c'est ce qui grise un bouton avant l'aller-retour
 * plutôt qu'après, et ce qui permet de dire *ce qui manque* au lieu de rapporter un refus.
 * La garder à un seul endroit, testable, est ce qui l'empêche de diverger des deux autres.
 */

/** Le repli quand les réglages ne sont pas encore chargés : rien n'est exigé. */
export const NO_RULE: ReviewRequestRule = { requireNote: false, minNoteLength: 5 };

/**
 * La requête des réglages effectifs du projet, décrite une fois.
 *
 * Même clé de cache que partout ailleurs (`qk.projectSettings`) : l'onglet Réglages a
 * souvent déjà chargé la fiche, et une seconde requête pour la même donnée serait du
 * gaspillage. Le hook et le lecteur hors composant la partagent, pour qu'ils ne puissent
 * pas interroger deux endroits différents.
 */
const ruleQuery = (projectId: number) => ({
  queryKey: qk.projectSettings(projectId),
  queryFn: () =>
    api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`).then((d) => d.settings),
  staleTime: 5 * 60_000,
});

/** La règle du projet, telle que la lit un écran. */
export function useReviewRequestRule(projectId: number | undefined, enabled = true): ReviewRequestRule {
  const { data } = useQuery({ ...ruleQuery(projectId ?? 0), enabled: enabled && !!projectId });
  return data?.reviewRequest ?? NO_RULE;
}

/**
 * La même règle, lue HORS composant — la file d'upload doit la connaître avant d'avoir un
 * écran à rendre, et un `useQuery` ne se lit pas depuis un store.
 *
 * Même clé et même requête que le hook : le cache déjà chaud répond sans aller-retour, et
 * la règle ne peut pas dire deux choses différentes selon qui la demande.
 *
 * Règle illisible (réseau coupé, projet inconnu) : on retombe sur « rien n'est exigé ».
 * Bloquer un dépôt sur un aller-retour manqué ferait perdre le travail d'un artiste, alors
 * que le serveur reste l'autorité et refusera l'envoi si le projet l'impose.
 */
export async function fetchReviewRequestRule(
  projectId: number | null | undefined,
): Promise<ReviewRequestRule> {
  if (!projectId) return NO_RULE;
  try {
    const settings = await queryClient.ensureQueryData(ruleQuery(projectId));
    return settings.reviewRequest ?? NO_RULE;
  } catch {
    return NO_RULE;
  }
}

/** Ce qui cloche sur une consigne, ou `null` si elle convient. */
export type NoteIssue = 'missing' | 'too-short' | null;

/**
 * Même verdict que `checkReviewNote` côté serveur, à la lettre : l'espace ne compte pas,
 * une consigne vide n'est un problème que si le projet l'exige, et le plancher s'applique
 * à toute consigne écrite — y compris facultative.
 */
export function noteIssue(note: string, rule: ReviewRequestRule): NoteIssue {
  const text = note.trim();
  if (!text) return rule.requireNote ? 'missing' : null;
  return text.length < rule.minNoteLength ? 'too-short' : null;
}

/** Ce qu'on envoie : une consigne vide part en `null`, comme le serveur la range. */
export const toNotePayload = (note: string): string | null => note.trim() || null;
