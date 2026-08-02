// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Panel } from './AdminPrimitives';
import BurninPanel from './BurninPanel';
import { useT } from '../../i18n';

interface WatermarkConfig {
  internal: boolean;
  shares: boolean;
  opacity: number;
}

/**
 * Section Diffusion (35.B/35.D) : logo studio (page client + burn-ins) et watermark
 * spectateur (viewers internes + partages).
 */
export default function DistributionTab() {
  return (
    <div className="max-w-2xl space-y-4">
      <LogoPanel />
      <WatermarkPanel />
      <BurninPanel />
    </div>
  );
}

function LogoPanel() {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const logoQ = useQuery({
    queryKey: qk.admin('studio-logo'),
    queryFn: () => api.get<{ url: string | null }>('/api/studio/logo'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.admin('studio-logo') });

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
      toast.error(err instanceof Error ? err.message : 'Erreur');
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
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('burnin.studioLogo')}>
      <p className="mb-3 text-xs text-muted-foreground">
        Affiché sur la page client des liens de partage et utilisable en burn-in sur les proxys.
      </p>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
          {logoQ.data?.url ? (
            <img src={logoQ.data.url} alt="Logo studio" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">{t('distribution.noLogo')}</span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onFile}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} className="mr-1" /> {t('common.upload')}
        </Button>
        {logoQ.data?.url && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
            <Trash2 size={14} className="mr-1 text-destructive" /> {t('common.remove')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

function WatermarkPanel() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('watermark'),
    queryFn: () => api.get<{ watermark: WatermarkConfig }>('/api/studio/watermark').then((d) => d.watermark),
  });
  const [draft, setDraft] = useState<WatermarkConfig | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data);
  if (!draft) return <Panel title="Watermark spectateur">…</Panel>;

  const set = (patch: Partial<WatermarkConfig>) => setDraft((d) => d && { ...d, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      const { watermark } = await api.put<{ watermark: WatermarkConfig }>('/api/studio/watermark', draft);
      setDraft(watermark);
      qc.invalidateQueries({ queryKey: qk.admin('watermark') });
      toast.success(t('distribution.watermarkSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Watermark spectateur">
      <p className="mb-3 text-xs text-muted-foreground">
        Filigrane discret avec l'identité du spectateur, incrusté à l'écran par-dessus les médias (dissuasif
        contre les fuites).
      </p>
      <div className="space-y-2.5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary"
            checked={draft.shares}
            onChange={(e) => set({ shares: e.target.checked })}
          />
          <span className="font-medium">{t('distribution.onClientShares')}</span>
          <span className="text-xs text-muted-foreground">(nom du lien + date)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary"
            checked={draft.internal}
            onChange={(e) => set({ internal: e.target.checked })}
          />
          <span className="font-medium">{t('distribution.inInternalReviews')}</span>
          <span className="text-xs text-muted-foreground">(nom du compte connecté)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('review.opacity')}</span>
          <input
            type="range"
            min={2}
            max={40}
            value={Math.round(draft.opacity * 100)}
            onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
            className="accent-primary"
          />
          <span className="w-10 text-xs text-muted-foreground">{Math.round(draft.opacity * 100)} %</span>
        </label>
      </div>
      <div className="mt-3">
        <Button size="sm" onClick={save} disabled={busy}>
          <Save size={14} className="mr-1" /> {t('common.save')}
        </Button>
      </div>
    </Panel>
  );
}
