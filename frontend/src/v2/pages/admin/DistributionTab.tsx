// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { QueryState } from '../../components/ui/query-state';
import { Panel } from './AdminPrimitives';
import BurninPanel from './BurninPanel';
import SettingsPointer from './SettingsPointer';
import { useT } from '../../i18n';

interface WatermarkConfig {
  internal: boolean;
  shares: boolean;
  opacity: number;
}

/**
 * Section Diffusion (35.B/35.D) : watermark spectateur (viewers internes + partages) et
 * burn-ins.
 *
 * Le logo du studio se déposait ici, alors que la page de connexion l'affiche aussi : la
 * même marque se réglait à deux endroits, et celui qu'on ouvrait n'était pas toujours le
 * bon. Il vit désormais avec le nom et la couleur du studio ; cet écran y renvoie.
 */
export default function DistributionTab() {
  const t = useT();
  return (
    <div className="max-w-2xl space-y-4">
      <SettingsPointer section="settings" label={t('settings.group.studio')} hint={t('burnin.studioLogo')} />
      <WatermarkPanel />
      <BurninPanel />
    </div>
  );
}

function WatermarkPanel() {
  const t = useT();
  const qc = useQueryClient();
  const watermarkQ = useQuery({
    queryKey: qk.admin('watermark'),
    queryFn: () => api.get<{ watermark: WatermarkConfig }>('/api/studio/watermark').then((d) => d.watermark),
  });
  const data = watermarkQ.data;
  const [draft, setDraft] = useState<WatermarkConfig | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data);
  if (!draft)
    return (
      <Panel title={t('dist.watermarkTitle')}>
        <QueryState query={watermarkQ} compact />
      </Panel>
    );

  const set = (patch: Partial<WatermarkConfig>) => setDraft((d) => d && { ...d, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      const { watermark } = await api.put<{ watermark: WatermarkConfig }>('/api/studio/watermark', draft);
      setDraft(watermark);
      void qc.invalidateQueries({ queryKey: qk.admin('watermark') });
      toast.success(t('distribution.watermarkSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('dist.watermarkTitle')}>
      <p className="mb-3 text-xs text-muted-foreground">{t('dist.watermarkHint')}</p>
      <div className="space-y-2.5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary"
            checked={draft.shares}
            onChange={(e) => set({ shares: e.target.checked })}
          />
          <span className="font-medium">{t('distribution.onClientShares')}</span>
          <span className="text-xs text-muted-foreground">{t('dist.linkNameDate')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary"
            checked={draft.internal}
            onChange={(e) => set({ internal: e.target.checked })}
          />
          <span className="font-medium">{t('distribution.inInternalReviews')}</span>
          <span className="text-xs text-muted-foreground">{t('dist.accountName')}</span>
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
