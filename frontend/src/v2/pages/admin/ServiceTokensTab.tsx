// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import EmptyState from '../../components/ui/empty-state';
import EntityContextMenu from '../../components/ui/entity-menu';
import { Panel } from './AdminPrimitives';
import ServiceTokenDialog from './ServiceTokenDialog';
import { serviceTokensKey, type ServiceTokenRow } from '../../components/tokens/tokenApi';
import { scopeLevel, type ScopeLevel } from '../../components/tokens/tokenScopes';
import { useT, intlLocale, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

const LEVEL_KEY: Record<ScopeLevel, MessageKey> = {
  admin: 'tokens.scope.adminBadge',
  write: 'tokens.readWrite',
  read: 'tokens.read',
};

const LEVEL_VARIANT: Record<ScopeLevel, 'destructive' | 'warning' | 'secondary'> = {
  admin: 'destructive',
  write: 'warning',
  read: 'secondary',
};

/** Rôle du compte porteur : ce que le robot peut faire, indépendamment de ses scopes. */
const roleLabel = (t: Tr, role: string): string => {
  if (role === 'SUPERVISOR') return t('role.supervisor');
  if (role === 'CLIENT') return t('role.client');
  if (role === 'ADMIN') return t('role.admin');
  return t('role.artist');
};

const isExpired = (tok: ServiceTokenRow): boolean =>
  tok.expiresAt !== null && new Date(tok.expiresAt).getTime() < Date.now();

/**
 * Tokens de service (36.C) : les identités machine du studio — ferme de rendu, daemon
 * Prism, bot. Jusqu'ici le backend savait les émettre et seule une commande curl y
 * accédait ; cet écran rend visibles le rôle effectif, le cantonnement projet,
 * l'expiration et la dernière utilisation, seules réponses qui comptent devant un robot.
 */
export default function ServiceTokensTab() {
  const t = useT();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const tokensQ = useQuery({
    queryKey: serviceTokensKey,
    queryFn: () => api.get<{ tokens: ServiceTokenRow[] }>('/api/admin/service-tokens').then((d) => d.tokens),
  });
  const tokens = tokensQ.data ?? [];

  const revoke = async (tok: ServiceTokenRow) => {
    try {
      await api.del(`/api/admin/service-tokens/${tok.id}`);
      toast.success(t('tokens.revoked'));
      void qc.invalidateQueries({ queryKey: serviceTokensKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Panel title={t('tokens.service.title')}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('tokens.service.intro')}</p>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} className="mr-1" /> {t('tokens.service.new')}
          </Button>
        </div>
        {tokens.length === 0 && !tokensQ.isPending && (
          <EmptyState
            compact
            icon={Bot}
            title={t('tokens.service.empty')}
            description={t('tokens.service.emptyHint')}
          />
        )}
        <div className="space-y-1.5">
          {tokens.map((tok) => (
            <EntityContextMenu
              key={tok.id}
              entries={[
                {
                  id: 'revoke',
                  label: t('shares.revoke'),
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: () => void revoke(tok),
                },
              ]}
            >
              <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
                <Bot size={15} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{tok.name}</span>
                    <Badge variant={LEVEL_VARIANT[scopeLevel(tok.scopes)]}>
                      {t(LEVEL_KEY[scopeLevel(tok.scopes)])}
                    </Badge>
                    <Badge variant="outline">{roleLabel(t, tok.user.role)}</Badge>
                    <Badge variant={tok.project ? 'info' : 'muted'}>
                      {tok.project?.name ?? t('tokens.allProjects')}
                    </Badge>
                    {isExpired(tok) && <Badge variant="destructive">{t('tokens.expired')}</Badge>}
                  </div>
                  {tok.description && (
                    <p className="truncate text-xs text-muted-foreground">{tok.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('tokens.createdOn', { date: fmt(tok.createdAt) })}
                    {tok.lastUsedAt
                      ? ` · ${t('tokens.usedOn', { date: fmt(tok.lastUsedAt) })}`
                      : ` · ${t('common.neverUsed')}`}
                    {tok.expiresAt ? ` · ${t('tokens.expiresOn', { date: fmt(tok.expiresAt) })}` : ''}
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">
                    <code>{tok.scopes.join(' ')}</code>
                  </p>
                </div>
              </div>
            </EntityContextMenu>
          ))}
        </div>
        {tokens.length > 0 && <p className="mt-2 text-2xs text-muted-foreground">{t('tokens.revokeHint')}</p>}
      </Panel>
      <ServiceTokenDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
