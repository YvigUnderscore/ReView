// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { parseIdParam, reviewPath } from '../../lib/slug';
import type { AssetLatest } from '../../types/api';
import { useT } from '../../i18n';

/**
 * `/assets/:id/latest` et `/shots/:id/latest` — adresse stable de l'état le plus avancé
 * d'une entité (Phase 45, étendue aux plans en C3).
 *
 * Un lien collé dans une note de production, un ticket ou un message doit rester juste
 * quand le travail avance. Celui-ci se résout à chaque ouverture : il emmène sur la review
 * du média de l'étape la plus aval, ou sur la page de l'entité s'il n'y a rien à montrer.
 */
export default function AssetLatestRedirect({ entity = 'asset' }: { entity?: 'asset' | 'shot' }) {
  const t = useT();
  const { id } = useParams();
  const entityId = parseIdParam(id);
  const segment = entity === 'shot' ? 'shots' : 'assets';
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.entityLatest(entity, entityId),
    queryFn: () =>
      api.get<{ latest: AssetLatest }>(`/api/${segment}/${entityId}/latest`).then((d) => d.latest),
    enabled: Number.isFinite(entityId),
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  // Sans version publiée (ou sans média), la page de l'entité reste la meilleure destination :
  // elle montre l'arbre complet, brouillons compris, plutôt qu'une erreur.
  if (isError || !data?.media) return <Navigate to={`/${segment}/${entityId}`} replace />;
  return <Navigate to={reviewPath(data.media)} replace />;
}
