// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePipelineStatuses } from '../../lib/shotgridApi';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';

/**
 * Pastille d'un statut de pipeline.
 *
 * La couleur vient du référentiel (celle du site ShotGrid quand il en fournit une),
 * pas d'une table figée : c'est tout l'intérêt d'avoir rendu les statuts éditables.
 * Sans statut posé, le composant ne rend rien plutôt qu'un espace vide décoratif.
 *
 * La teinte du site est reprise telle quelle pour le fond, mais le texte passe par
 * `statusSwatch` (A2) : un `bg_color` sombre venu de ShotGrid était illisible sur le
 * thème bleu nuit, un jaune pâle l'était sur le thème clair.
 */
export default function PipelineStatusBadge({
  statusId,
  scope,
  size = 'sm',
}: {
  statusId: number | null | undefined;
  scope: 'task' | 'shot' | 'sequence';
  size?: 'sm' | 'xs';
}) {
  const { data: statuses = [] } = usePipelineStatuses(scope);
  const theme = useTheme((s) => s.theme);
  if (!statusId) return null;
  const status = statuses.find((s) => s.id === statusId);
  if (!status) return null;
  const swatch = statusSwatch(status.color, theme === 'dark');

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 ${
        size === 'xs' ? 'text-2xs' : 'py-0.5 text-xs'
      } ${swatch ? '' : 'bg-secondary text-muted-foreground'}`}
      style={swatch ? { backgroundColor: swatch.backgroundColor, color: swatch.color } : undefined}
      title={status.code}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${swatch ? '' : 'bg-muted-foreground'}`}
        style={swatch ? { backgroundColor: status.color } : undefined}
      />
      {status.name}
    </span>
  );
}
