// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePipelineStatuses } from '../../lib/shotgridApi';

/**
 * Pastille d'un statut de pipeline.
 *
 * La couleur vient du référentiel (celle du site ShotGrid quand il en fournit une),
 * pas d'une table figée : c'est tout l'intérêt d'avoir rendu les statuts éditables.
 * Sans statut posé, le composant ne rend rien plutôt qu'un espace vide décoratif.
 */
export default function PipelineStatusBadge({
  statusId,
  scope,
  size = 'sm',
}: {
  statusId: number | null | undefined;
  scope: 'task' | 'shot';
  size?: 'sm' | 'xs';
}) {
  const { data: statuses = [] } = usePipelineStatuses(scope);
  if (!statusId) return null;
  const status = statuses.find((s) => s.id === statusId);
  if (!status) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 ${
        size === 'xs' ? 'text-[10px]' : 'py-0.5 text-xs'
      }`}
      style={{ backgroundColor: `${status.color}22`, color: status.color }}
      title={status.code}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}
