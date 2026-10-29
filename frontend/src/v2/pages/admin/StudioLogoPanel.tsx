// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Panel } from './AdminPrimitives';
import { useT } from '../../i18n';
import { Hint } from '../../components/ui/hint';

/**
 * The studio logo — **a single one**, and a single place to upload it.
 *
 * It used to be set in "Distribution", although the login page shows it too and
 * the slates and burn-ins reuse it: three screens showed the same brand, and the one
 * holding it was not the one one opened to change it. It now lives with the
 * studio's name and colour; the other screens point to it.
 *
 * A file upload saves on its own: it is the only gesture on the page that does not
 * go through its action bar.
 */
export default function StudioLogoPanel() {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const logoQ = useQuery({
    queryKey: qk.admin('studio-logo'),
    queryFn: () => api.get<{ url: string | null }>('/api/studio/logo'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.admin('studio-logo') });
    void qc.invalidateQueries({ queryKey: qk.admin('settings') });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error(t('profile.avatar.invalidFormat'));
      return;
    }
    setBusy(true);
    try {
      const { url, key } = await api.post<{ url: string; key: string }>('/api/studio/logo/presign', {
        contentType: file.type,
      });
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(t('profile.avatar.uploadFailed'));
      await api.put('/api/studio/settings', { key: 'studio_logo_key', value: key });
      invalidate();
      toast.success(t('distribution.logoUpdated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.put('/api/studio/settings', { key: 'studio_logo_key', value: '' });
      invalidate();
      toast.success(t('distribution.logoDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('burnin.studioLogo')}>
      <Hint>{t('dist.slateHint')}</Hint>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
          {logoQ.data?.url ? (
            <img
              src={logoQ.data.url}
              alt={t('burnin.studioLogo')}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t('distribution.noLogo')}</span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} className="mr-1" /> {t('common.upload')}
        </Button>
        {logoQ.data?.url && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={14} className="mr-1 text-destructive" /> {t('common.remove')}
          </Button>
        )}
      </div>
    </Panel>
  );
}
