// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import AttentionPanel from '../../../components/production/AttentionPanel';
import { SkeletonRows } from '../../../components/ui/skeleton';
import type { ProductionOverview } from '../../../types/production';

/**
 * Ce qui bloque : en retard, sans assigné, en attente de review.
 *
 * Le panneau existe depuis la phase 43 et ne vivait que dans l'onglet Production — c'est-à-dire
 * à deux clics de la page qu'un superviseur ouvre en premier. Il lit la même route, avec la
 * fenêtre de rythme par défaut : la vue d'ensemble ne règle pas de fenêtre, elle annonce.
 *
 * `requireProjectManage` côté serveur : le bloc n'existe que pour qui gère le projet, et le
 * registre le sait (`manage: true`) — il n'est donc jamais proposé aux autres.
 */
const DEFAULT_WEEKS = 8;

export default function AttentionWidget({ projectId }: { projectId: number }) {
  const { data, error } = useQuery({
    queryKey: qk.projectProduction(projectId, DEFAULT_WEEKS),
    queryFn: () =>
      api.get<ProductionOverview>(`/api/projects/${projectId}/production?weeks=${DEFAULT_WEEKS}`),
  });

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (!data) return <SkeletonRows count={3} />;
  return <AttentionPanel data={data} />;
}
