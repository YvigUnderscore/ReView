// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Link2, Lock, Mail, Plus, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { useT, intlLocale } from '../../i18n';
import CreateShareDialog from './shares/CreateShareDialog';
import ShareEmailDialog from './shares/ShareEmailDialog';
import { clientUrl } from './shares/shareUrl';
import { scopeBadge, type ScopedShareLink } from './shares/shareScope';

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

/**
 * Onglet Partages (35.C) : liens client durcis — portée, mot de passe, expiration, limite
 * de vues. L'envoi par courriel et la copie passent par le clic droit sur la ligne (règle
 * d'interface : pas de nouveau bouton visible tant qu'un menu contextuel suffit).
 */
export default function SharesTab({ projectId }: { projectId: number }) {
  const t = useT();
  const qc = useQueryClient();
  const linksQ = useQuery({
    queryKey: qk.shareLinks(projectId),
    queryFn: () => api.get<{ links: ScopedShareLink[] }>(`/api/share?projectId=${projectId}`),
  });
  const links = linksQ.data?.links ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [emailFor, setEmailFor] = useState<ScopedShareLink | null>(null);

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(clientUrl(token));
    toast.success(t('shares.copied'));
  };
  const revoke = async (link: ScopedShareLink) => {
    try {
      await api.del(`/api/share/${link.id}`);
      toast.success(t('shares.revokedToast'));
      void qc.invalidateQueries({ queryKey: qk.shareLinks(projectId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const badgeOf = (link: ScopedShareLink) =>
    scopeBadge(link, {
      project: t('shares.scope.badge.project'),
      selection: (count) => t('shares.scope.badge.selection', { count }),
      restricted: t('shares.scope.badge.restricted'),
    });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('shares.title')}</h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" /> {t('shares.newShort')}
        </Button>
      </div>
      {linksQ.error && <p className="mb-3 text-sm text-destructive">{linksQ.error.message}</p>}
      {links.length === 0 && !linksQ.isLoading && (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('shares.empty')}
        </p>
      )}
      <div className="space-y-1.5">
        {links.map((l) => (
          <ContextMenu key={l.id}>
            <ContextMenuTrigger asChild>
              <div
                className={`flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm ${l.revoked ? 'opacity-50' : ''}`}
              >
                <Link2 size={15} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{l.label ?? t('shares.unnamed')}</span>
                    <Badge variant={l.permission === 'COMMENT' ? 'default' : 'secondary'}>
                      {l.permission === 'COMMENT' ? t('admin.tab.comments') : t('shares.permission.readOnly')}
                    </Badge>
                    {l.hasPassword && (
                      <span title={t('shares.passwordProtected')}>
                        <Lock size={13} className="text-muted-foreground" />
                      </span>
                    )}
                    {l.revoked && <Badge variant="destructive">{t('shares.revoked')}</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1" title={t('shares.scope')}>
                      <Target size={12} />
                      {badgeOf(l)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye size={12} />
                      {l.viewCount}
                      {l.maxViews != null ? ` / ${l.maxViews}` : ''}{' '}
                      {t('shares.viewCount', { count: l.viewCount })}
                    </span>
                    {l.expiresAt && (
                      <span>{t('shares.expiresOn', { date: fmtDate(l.expiresAt) ?? '' })}</span>
                    )}
                    {l.lastViewedAt && (
                      <span>{t('shares.viewedOn', { date: fmtDate(l.lastViewedAt) ?? '' })}</span>
                    )}
                    {l.createdBy?.name && <span>{t('shares.createdBy', { name: l.createdBy.name })}</span>}
                  </div>
                </div>
                {!l.revoked && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copy(l.token)}
                      title={t('shares.copyUrl')}
                    >
                      <Copy size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void revoke(l)}
                      title={t('shares.revoke')}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem disabled={l.revoked} onClick={() => void copy(l.token)}>
                <Copy size={14} /> {t('shares.copyUrl')}
              </ContextMenuItem>
              <ContextMenuItem disabled={l.revoked} onClick={() => setEmailFor(l)}>
                <Mail size={14} /> {t('shares.email')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger disabled={l.revoked} onClick={() => void revoke(l)}>
                <Trash2 size={14} /> {t('shares.revoke')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <CreateShareDialog projectId={projectId} open={createOpen} onClose={() => setCreateOpen(false)} />
      <ShareEmailDialog link={emailFor} onClose={() => setEmailFor(null)} />
    </div>
  );
}
