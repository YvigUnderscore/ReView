// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Link2, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import type { ShareLink } from '../../types/api';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

const clientUrl = (token: string) => `${window.location.origin}/client/${token}`;

/** Onglet Partages (35.C) : liens client durcis — mot de passe, expiration, limite de vues. */
export default function SharesTab({ projectId }: { projectId: number }) {
  const t = useT();
  const qc = useQueryClient();
  const linksQ = useQuery({
    queryKey: qk.shareLinks(projectId),
    queryFn: () => api.get<{ links: ShareLink[] }>(`/api/share?projectId=${projectId}`),
  });
  const links = linksQ.data?.links ?? [];
  const [createOpen, setCreateOpen] = useState(false);

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(clientUrl(token));
    toast.success(t('shares.copied'));
  };
  const revoke = async (link: ShareLink) => {
    try {
      await api.del(`/api/share/${link.id}`);
      toast.success(t('shares.revokedToast'));
      void qc.invalidateQueries({ queryKey: qk.shareLinks(projectId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

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
          <div
            key={l.id}
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
                <span className="flex items-center gap-1">
                  <Eye size={12} />
                  {l.viewCount}
                  {l.maxViews != null ? ` / ${l.maxViews}` : ''}{' '}
                  {t('shares.viewCount', { count: l.viewCount })}
                </span>
                {l.expiresAt && <span>{t('shares.expiresOn', { date: fmtDate(l.expiresAt) ?? '' })}</span>}
                {l.lastViewedAt && (
                  <span>{t('shares.viewedOn', { date: fmtDate(l.lastViewedAt) ?? '' })}</span>
                )}
                {l.createdBy?.name && <span>{t('shares.createdBy', { name: l.createdBy.name })}</span>}
              </div>
            </div>
            {!l.revoked && (
              <>
                <Button variant="ghost" size="sm" onClick={() => copy(l.token)} title={t('shares.copyUrl')}>
                  <Copy size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => revoke(l)} title={t('shares.revoke')}>
                  <Trash2 size={14} className="text-destructive" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <CreateShareDialog projectId={projectId} open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateShareDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [permission, setPermission] = useState<'VIEW' | 'COMMENT'>('VIEW');
  const [password, setPassword] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { link } = await api.post<{ link: ShareLink }>('/api/share', {
        projectId,
        permission,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(password ? { password } : {}),
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
        ...(maxViews ? { maxViews: Number(maxViews) } : {}),
      });
      await navigator.clipboard.writeText(clientUrl(link.token)).catch(() => undefined);
      toast.success(t('shares.created'));
      void qc.invalidateQueries({ queryKey: qk.shareLinks(projectId) });
      setLabel('');
      setPassword('');
      setExpiresInDays('');
      setMaxViews('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shares.new')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="share-label">{t('shares.recipient')}</Label>
            <Input
              id="share-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('shares.recipient.placeholder')}
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="share-permission">{t('shares.permission')}</Label>
            <Select
              id="share-permission"
              value={permission}
              onChange={(e) => setPermission(e.target.value as 'VIEW' | 'COMMENT')}
            >
              <option value="VIEW">{t('shares.permission.readOnly')}</option>
              <option value="COMMENT">{t('shares.permission.comment')}</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="share-expires">{t('shares.expiry')}</Label>
              <Input
                id="share-expires"
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder={t('common.never')}
              />
            </div>
            <div>
              <Label htmlFor="share-max-views">{t('shares.viewLimit')}</Label>
              <Input
                id="share-max-views"
                type="number"
                min={1}
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                placeholder={t('common.unlimited')}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="share-password">{t('shares.password')}</Label>
            <Input
              id="share-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('common.none')}
              minLength={4}
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.undo')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t('shares.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
