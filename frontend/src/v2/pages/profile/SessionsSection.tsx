// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { deviceLabel } from '../../lib/deviceLabel';
import { useAuth } from '../../stores/useAuth';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Sessions actives du compte (36.B) : liste des appareils connectés + révocation. */
export default function SessionsSection() {
  const t = useT();
  const qc = useQueryClient();
  const logout = useAuth((s) => s.logout);
  const sessionsQ = useQuery({
    queryKey: qk.authSessions,
    queryFn: () => api.get<{ sessions: SessionRow[] }>('/api/auth/sessions').then((d) => d.sessions),
  });
  const sessions = sessionsQ.data ?? [];

  const revoke = async (s: SessionRow) => {
    try {
      await api.del(`/api/auth/sessions/${s.id}`);
      if (s.current) {
        logout();
        return;
      }
      toast.success(t('userDetail.sessionRevoked'));
      qc.invalidateQueries({ queryKey: qk.authSessions });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{t('sessions.title')}</h2>
      {sessions.length === 0 && <p className="text-xs text-muted-foreground">{t('sessions.empty')}</p>}
      <div className="space-y-1.5">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <MonitorSmartphone size={16} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{deviceLabel(s.userAgent)}</span>
                {s.current && <Badge>{t('sessions.thisDevice')}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('sessions.line', {
                  ip: s.ip ?? t('sessions.unknownIp'),
                  created: fmt(s.createdAt),
                  seen: fmt(s.lastSeenAt),
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              title={s.current ? t('common.signOut') : t('shares.revoke')}
              onClick={() => revoke(s)}
            >
              <Trash2 size={14} className="text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
