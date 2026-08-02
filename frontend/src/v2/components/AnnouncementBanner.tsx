// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, AlertTriangle, Wrench, X } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import type { Announcement, AnnouncementType } from '../types/api';

const STYLE: Record<AnnouncementType, { cls: string; Icon: typeof Info }> = {
  INFO: { cls: 'border-info/40 bg-info/10 text-info', Icon: Info },
  WARNING: { cls: 'border-warning/40 bg-warning/10 text-warning', Icon: AlertTriangle },
  MAINTENANCE: { cls: 'border-destructive/40 bg-destructive/10 text-destructive', Icon: Wrench },
};

/**
 * Bannières d'annonces studio actives pour l'utilisateur (Phase 22). Le backend filtre déjà
 * par période / rôle / fréquence ; la fermeture pose un accusé de lecture (masque selon la
 * fréquence : permanent → réapparaît, 1re connexion/du jour → masquée durablement).
 */
export default function AnnouncementBanner() {
  const { data } = useQuery({
    queryKey: qk.announcementsActive,
    queryFn: () =>
      api.get<{ announcements: Announcement[] }>('/api/announcements/active').then((d) => d.announcements),
  });
  const [dismissed, setDismissed] = useState<number[]>([]);

  const dismiss = (id: number) => {
    setDismissed((d) => [...d, id]);
    void api.post(`/api/announcements/${id}/ack`, {}).catch(() => undefined);
  };

  const items = (data ?? []).filter((a) => !dismissed.includes(a.id));
  if (items.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {items.map((a) => {
        const { cls, Icon } = STYLE[a.type];
        return (
          <div key={a.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${cls}`}>
            <Icon size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 text-foreground">
              <div className="text-sm font-semibold">{a.title}</div>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
            </div>
            <button
              onClick={() => dismiss(a.id)}
              title="Fermer"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
