import { reviewStatusStyle } from './reviewDecision.helpers';
import type { ReviewStatus } from '../types/api';

/**
 * Badge de décision de review (Phase 31). La couleur vient du statut configuré
 * par le studio (donnée dynamique → style inline, pas un token de thème).
 */
export default function ReviewDecisionBadge({
  status,
  title,
}: {
  status: Pick<ReviewStatus, 'name' | 'color'>;
  title?: string;
}) {
  return (
    <span
      title={title ?? `Décision : ${status.name}`}
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={reviewStatusStyle(status.color)}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}
