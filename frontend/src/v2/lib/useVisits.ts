// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useT } from '../i18n';

/**
 * L'acquittement de visite, côté client (Phase 50, lot 9).
 *
 * Le calcul de la lueur appartient au serveur : le client ne fait que dire « je l'ai
 * ouvert » et redemander les listes. Rien n'est déduit ici — deux personnes ouvrant le même
 * plan n'éteignent que leur propre carte, et une lueur calculée côté client se serait
 * remise à mentir au premier changement venu d'ailleurs.
 */

/** Les niveaux qu'une carte sait allumer — miroir de l'énumération acceptée par la route. */
export type VisitTarget = 'PROJECT' | 'SEQUENCE' | 'SHOT' | 'ASSET' | 'TASK' | 'MEDIA';

/** Les listes qui portent un « tout marquer comme lu ». */
export type VisitListTarget = 'SEQUENCE' | 'SHOT' | 'ASSET';

/**
 * Les caches qui portent un `unseen`, invalidés d'un bloc dès qu'une visite est acquittée.
 *
 * Invalidation par **préfixe** et non par clé exacte : un plan visité s'éteint dans l'onglet
 * Plans du projet, dans la fiche de sa séquence, et dans la liste d'un autre projet ouverte
 * dans un autre onglet du navigateur. Énumérer les clés exactes aurait demandé de connaître
 * ici le projet et la séquence de l'entité — soit une occasion, par écran, d'en oublier une,
 * et une carte qui reste allumée juste après qu'on l'a fermée.
 */
const GLOWING_LISTS: QueryKey[] = [['shots'], ['sequences'], ['sequence'], ['assets']];

/** Redemande tout ce qui affiche une lueur. */
async function refreshGlow(invalidate: (key: QueryKey) => Promise<void>) {
  await Promise.all(GLOWING_LISTS.map((key) => invalidate(key)));
}

/**
 * « J'ouvre cette entité » : éteint sa lueur, une fois, au montage de sa page.
 *
 * `id` peut arriver indéfini ou aberrant (paramètre d'URL en cours de résolution) : rien
 * n'est alors envoyé. Un acquittement qui échoue est **silencieux** — la lueur restera
 * allumée, ce qui est le pire qui puisse arriver, et cela ne vaut pas d'interrompre la
 * lecture d'une page par un message d'erreur sur une notion secondaire.
 */
export function useMarkVisited(target: VisitTarget, id: number | undefined, enabled = true) {
  const qc = useQueryClient();
  // Un seul acquittement par entité et par montage : la page se re-rend à chaque
  // chargement de données, et un effet non gardé aurait posté à chaque fois.
  const acknowledged = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !id || !Number.isFinite(id) || id <= 0) return;
    const token = `${target}:${id}`;
    if (acknowledged.current === token) return;
    acknowledged.current = token;
    void (async () => {
      try {
        await api.post('/api/visits', { targetType: target, targetId: id });
      } catch {
        return;
      }
      await refreshGlow((key) => qc.invalidateQueries({ queryKey: key }));
    })();
  }, [target, id, enabled, qc]);
}

/**
 * « Tout marquer comme lu » pour une liste d'un projet.
 *
 * Le corps ne porte que le type et le projet : c'est le serveur qui établit les entités
 * concernées. Poster la liste des ids affichés aurait demandé d'en vérifier
 * l'appartenance une par une côté serveur, et aurait laissé allumé ce qu'un filtre cachait.
 */
export function useMarkAllSeen(target: VisitListTarget, projectId: number) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: () => api.post<{ marked: number }>('/api/visits/mark-all', { targetType: target, projectId }),
    onSuccess: async ({ marked }) => {
      toast.success(t('cards.markAllSeenDone', { count: marked }));
      await refreshGlow((key) => qc.invalidateQueries({ queryKey: key }));
    },
    onError: () => toast.error(t('common.error.generic')),
  });
}
