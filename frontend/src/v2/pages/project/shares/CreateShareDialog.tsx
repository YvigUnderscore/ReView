// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { useT } from '../../../i18n';
import ShareScopeFields from './ShareScopeFields';
import { clientUrl } from './shareUrl';
import { emptyScope, isScopeReady, scopePayload, type ScopedShareLink, type ScopeState } from './shareScope';

/** Création d'un lien client durci : portée, permission, expiration, limite de vues, mot de passe. */
export default function CreateShareDialog({
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
  const [scope, setScope] = useState<ScopeState>(emptyScope);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setLabel('');
    setPassword('');
    setExpiresInDays('');
    setMaxViews('');
    setScope(emptyScope);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isScopeReady(scope)) {
      toast.error(t('shares.scope.needsTarget'));
      return;
    }
    setBusy(true);
    try {
      const { link } = await api.post<{ link: ScopedShareLink }>('/api/share', {
        projectId,
        permission,
        ...scopePayload(scope),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(password ? { password } : {}),
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
        ...(maxViews ? { maxViews: Number(maxViews) } : {}),
      });
      await navigator.clipboard.writeText(clientUrl(link.token)).catch(() => undefined);
      toast.success(t('shares.created'));
      void qc.invalidateQueries({ queryKey: qk.shareLinks(projectId) });
      reset();
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
          <ShareScopeFields projectId={projectId} value={scope} onChange={setScope} />
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
