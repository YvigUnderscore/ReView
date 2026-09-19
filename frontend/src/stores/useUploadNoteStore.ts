// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { fetchReviewRequestRule } from '../v2/lib/reviewRequestRule';
import type { ReviewRequestRule } from '../v2/types/api';

/**
 * La consigne exigée À L'UPLOAD (Phase 50).
 *
 * Un média est publié dès son dépôt : le moment où l'on disait « voilà ce qu'il faut
 * regarder » — la publication — n'existe plus comme étape séparée. La consigne se demande
 * donc avant l'envoi, et un projet qui l'exige (`reviewRequest.requireNote`) fait qu'un
 * dépôt sans message ne part pas du tout.
 *
 * **Un seul point de passage.** Les cinq endroits d'où l'on dépose (fiche d'asset, fiche de
 * plan, fiche de tâche, timeline de versions, zone de dépôt) traversent `withUploadNote` et
 * rien d'autre : c'est ce qui évite qu'un sixième bouton oublie la règle. Le dépôt retenu
 * garde son geste entier en attente — rien n'est créé, pas même la version, tant que la
 * consigne ne convient pas.
 */

/** Un dépôt retenu : ce que le projet exige, et le geste qui reprendra la main. */
interface PendingDrop {
  rule: ReviewRequestRule;
  /** Le dépôt lui-même, rejoué avec la consigne écrite (ou `null` si rien n'est exigé). */
  run: (note: string | null) => void | Promise<void>;
}

interface UploadNoteState {
  /** Le dépôt en attente de sa consigne, s'il y en a un. */
  pending: PendingDrop | null;
  /** La consigne convient : le dépôt reprend. */
  submit: (note: string | null) => void;
  /** Renoncer : rien n'a été créé, rien n'est envoyé. */
  cancel: () => void;
}

export const useUploadNoteStore = create<UploadNoteState>((set, get) => ({
  pending: null,
  submit: (note) => {
    const pending = get().pending;
    // Libéré AVANT de rejouer le geste : celui-ci peut durer (création de version, hachage)
    // et le dialogue ne doit pas rester à l'écran pendant ce temps.
    set({ pending: null });
    void pending?.run(note);
  },
  cancel: () => set({ pending: null }),
}));

/**
 * Point d'entrée unique de tout dépôt de fichiers.
 *
 * Sans exigence de consigne, le dépôt part immédiatement — le chemin ordinaire ne gagne
 * aucun écran. Avec exigence, le geste attend `UploadNoteDialog`, monté une fois pour toute
 * l'application : les pages n'ont donc rien à rendre pour en bénéficier.
 */
export async function withUploadNote(
  projectId: number | null | undefined,
  run: (note: string | null) => void | Promise<void>,
): Promise<void> {
  const rule = await fetchReviewRequestRule(projectId);
  if (!rule.requireNote) {
    await run(null);
    return;
  }
  useUploadNoteStore.setState({ pending: { rule, run } });
}
