import { Badge } from '../../components/ui/badge';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Actif',
  ON_HOLD: 'En pause',
  COMPLETED: 'Terminé',
  ARCHIVED: 'Archivé',
};

/** Pastille de statut d'un projet (couleur dérivée du statut). */
export default function ProjectStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'ON_HOLD'
        ? 'warning'
        : status === 'COMPLETED'
          ? 'info'
          : ('muted' as const);
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}
