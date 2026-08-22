// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { intlLocale, useT } from '../../i18n';
import {
  canReplay,
  deliveryStatusKey,
  deliveryTone,
  responseExcerpt,
  type WebhookDeliveryRow,
} from './webhookLog';

/**
 * Journal des livraisons d'un webhook.
 *
 * Ce qui manquait n'était pas un tableau de plus : c'était de pouvoir répondre à « qu'a-t-on
 * perdu, et de quoi ». Chaque ligne porte l'identifiant annoncé au destinataire
 * (`X-ReView-Delivery`), ses tentatives et l'extrait de réponse qui explique l'échec.
 *
 * Le rejeu se demande au clic droit, comme les autres actions de l'application, et n'est
 * offert que sur un échec — rejouer une remise créerait un doublon chez le consommateur.
 */

const FIRST_PAGE = 25;
const MAX_PAGE = 100;

const when = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function WebhookDeliveries({ webhookId, active }: { webhookId: number; active: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [limit, setLimit] = useState(FIRST_PAGE);

  const deliveriesQ = useQuery({
    queryKey: qk.admin(`webhook-deliveries:${webhookId}:${limit}`),
    queryFn: () =>
      api.get<{ deliveries: WebhookDeliveryRow[]; nextCursor: number | null }>(
        `/api/admin/webhooks/${webhookId}/deliveries?limit=${limit}`,
      ),
  });
  const rows = deliveriesQ.data?.deliveries ?? [];
  const hasMore = deliveriesQ.data?.nextCursor != null && limit < MAX_PAGE;

  const replay = async (row: WebhookDeliveryRow) => {
    try {
      await api.post(`/api/admin/webhooks/${webhookId}/deliveries/${row.id}/replay`);
      toast.success(t('webhooks.delivery.replayed'));
      await qc.invalidateQueries({ queryKey: qk.admin(`webhook-deliveries:${webhookId}:${limit}`) });
      await qc.invalidateQueries({ queryKey: qk.admin('webhooks') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  if (deliveriesQ.isPending)
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</p>;

  if (rows.length === 0)
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t('webhooks.delivery.empty')}</p>;

  return (
    <div className="space-y-1 border-l-2 border-border pl-3">
      {rows.map((row) => (
        <ContextMenu key={row.id}>
          <ContextMenuTrigger asChild>
            <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50">
              <Badge variant={deliveryTone(row.status)}>{t(deliveryStatusKey(row.status))}</Badge>
              <code className="shrink-0">{row.event}</code>
              <span className="shrink-0 text-muted-foreground">
                {t('webhooks.delivery.attempts', { count: row.attempts })}
                {row.responseStatus != null && ` · ${row.responseStatus}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{responseExcerpt(row)}</span>
              {row.replayOfId != null && (
                <Badge variant="muted">{t('webhooks.delivery.replayOf', { value: row.replayOfId })}</Badge>
              )}
              {/* Identifiant annoncé au destinataire dans `X-ReView-Delivery` : technique,
                  donc jamais traduit — c'est ce que le consommateur cherchera dans ses logs. */}
              <code className="shrink-0 text-muted-foreground">#{row.id}</code>
              <span className="shrink-0 text-muted-foreground">{when(row.createdAt)}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!active || !canReplay(row)}
              onClick={() => {
                void replay(row);
              }}
            >
              {t('webhooks.delivery.replay')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      {hasMore && (
        <Button variant="ghost" size="sm" onClick={() => setLimit(MAX_PAGE)}>
          {t('list.loadMore')}
        </Button>
      )}
    </div>
  );
}
