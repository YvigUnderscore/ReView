// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useT } from '../i18n';

/**
 * « C'est fait — annuler ? » : la confirmation d'une écriture SERVEUR, avec le geste qui la
 * défait attaché au toast.
 *
 * Pourquoi pas Ctrl+Z. Changer un statut, assigner une tâche, réordonner une playlist, ce sont
 * des mutations partagées : parties au serveur, elles sont déjà chez les autres, et un moteur
 * ShotGrid a pu arbitrer derrière. Un Ctrl+Z laisserait croire à une pile locale qu'on ne tient
 * pas — on ne peut promettre que le coup **précédent**, et seulement parce qu'on en connaît la
 * valeur d'avant. C'est exactement ce que le toast offre : un cran, nommé, visible, à portée
 * immédiate, et qui disparaît avec lui plutôt que de laisser croire à un historique.
 *
 * L'annulation est une écriture comme une autre : elle peut échouer (droits, arbitrage ShotGrid,
 * réseau). Elle le dit alors, au lieu de laisser l'écran mentir sur l'état réel.
 */

/** Le toast reste plus longtemps que la normale : quatre secondes ne suffisent pas à se relire. */
const UNDO_TOAST_MS = 8000;

export interface UndoToast {
  /**
   * Annonce le succès, avec « Annuler » si l'inverse est connu.
   *
   * `undo` refait une écriture serveur et rend sa promesse : c'est elle qui décide du second
   * message. Omis, le toast est un simple succès — c'est le cas des actions sans inverse tenu.
   */
  done: (message: string, undo?: () => Promise<unknown>) => void;
}

export function useUndoToast(): UndoToast {
  const t = useT();

  const done = useCallback(
    (message: string, undo?: () => Promise<unknown>) => {
      if (!undo) {
        toast.success(message);
        return;
      }
      // Un seul passage : sonner ferme le toast au clic, mais un double-clic rapide sur
      // l'action rejouerait l'inverse — ici, remettrait un statut déjà remis.
      let spent = false;
      const id = toast.success(message, {
        duration: UNDO_TOAST_MS,
        action: {
          label: t('common.undo'),
          onClick: () => {
            if (spent) return;
            spent = true;
            toast.dismiss(id);
            void undo().then(
              () => toast.success(t('common.undone')),
              (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.undoFailed')),
            );
          },
        },
      });
    },
    [t],
  );

  return { done };
}
