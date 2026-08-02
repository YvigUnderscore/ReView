// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Panel } from './AdminPrimitives';
import WebhooksPanel from './WebhooksPanel';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

interface AdminTokenRow {
  id: number;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: { id: number; name: string | null; email: string };
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

/** Section « API & Webhooks » (36.C/36.D) : tokens d'API du studio + webhooks sortants. */
export default function ApiWebhooksTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <ApiTokensAdminPanel />
      <WebhooksPanel />
    </div>
  );
}

function ApiTokensAdminPanel() {
  const tr = useT();
  const qc = useQueryClient();
  const tokensQ = useQuery({
    queryKey: qk.admin('api-tokens'),
    queryFn: () => api.get<{ tokens: AdminTokenRow[] }>('/api/admin/api-tokens').then((d) => d.tokens),
  });
  const tokens = tokensQ.data ?? [];

  const revoke = async (id: number) => {
    try {
      await api.del(`/api/admin/api-tokens/${id}`);
      toast.success(tr('tokens.revoked'));
      qc.invalidateQueries({ queryKey: qk.admin('api-tokens') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <Panel title={tr('tokens.studio')}>
      <p className="mb-3 text-xs text-muted-foreground">
        Tous les tokens actifs, créés par chacun depuis sa page profil. Un token révoqué cesse immédiatement
        de fonctionner.
      </p>
      <div className="space-y-1.5">
        {tokens.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <KeyRound size={15} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                <Badge variant={t.scopes.includes('write') ? 'warning' : 'secondary'}>
                  {t.scopes.includes('write') ? 'écriture' : 'lecture'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.user.name ?? t.user.email} · créé le {fmt(t.createdAt)}
                {t.lastUsedAt ? ` · utilisé le ${fmt(t.lastUsedAt)}` : ' · jamais utilisé'}
              </p>
            </div>
            <Button variant="ghost" size="sm" title={tr('shares.revoke')} onClick={() => revoke(t.id)}>
              <Trash2 size={14} className="text-destructive" />
            </Button>
          </div>
        ))}
        {tokens.length === 0 && <p className="text-xs text-muted-foreground">{tr('tokens.empty')}</p>}
      </div>
    </Panel>
  );
}
