import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Video, Image as ImageIcon, Box, Boxes, type LucideIcon } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaKind, VersionDetail } from '../../types/api';

const KIND_ICON: Record<MediaKind, LucideIcon> = {
  VIDEO: Video,
  IMAGE: ImageIcon,
  MODEL_3D: Box,
  SPLAT: Boxes,
};

/**
 * Filmstrip généralisé (14.E) : bande des médias de la version courante (tous types).
 * Réutilise la query `qk.version` (déjà chargée par VersionNavigator) ; clic → média,
 * actif surligné. Masqué s'il n'y a qu'un média.
 */
export default function Filmstrip({ versionId, mediaId }: { versionId: number; mediaId: number }) {
  const navigate = useNavigate();
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  const media = versionQ.data?.media ?? [];
  if (media.length < 2) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-md border border-border bg-card/60 p-1.5">
      {media.map((m) => {
        const Icon = KIND_ICON[m.kind] ?? ImageIcon;
        const active = m.id === mediaId;
        return (
          <button
            key={m.id}
            onClick={() => !active && navigate(`/review/${m.id}`)}
            title={m.originalName}
            className={`flex h-12 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded border text-[10px] transition-colors ${
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            <Icon size={16} />
            <span className="max-w-full truncate px-1">{m.originalName}</span>
          </button>
        );
      })}
    </div>
  );
}
