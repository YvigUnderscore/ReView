// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Panel } from './AdminPrimitives';
import type { BurninConfig } from '../../types/share';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const burninflags = (t: Tr): { key: keyof BurninConfig & string; label: string; hint?: string }[] => [
  { key: 'enabled', label: t('burnin.onProxiesShort'), hint: t('burnin.shotVersionTc') },
  { key: 'showShot', label: t('burnin.shotCode'), hint: t('burnin.pos.topLeft') },
  { key: 'showVersion', label: t('burnin.versionName'), hint: t('burnin.pos.topRight') },
  { key: 'showTimecode', label: t('burnin.timecode'), hint: t('burnin.pos.bottomCentre') },
  { key: 'showLogo', label: t('burnin.studioLogo'), hint: t('burnin.bottomRight') },
  { key: 'slate', label: t('burnin.slateShort'), hint: t('burnin.slateHint') },
];

/** Template studio des burn-ins/slates (35.A) — appliqué aux prochains transcodages. */
export default function BurninPanel() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('burnin'),
    queryFn: () => api.get<{ config: BurninConfig }>('/api/admin/burnin').then((d) => d.config),
  });
  const [draft, setDraft] = useState<BurninConfig | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data);
  if (!draft) return <Panel title={t('burnin.title')}>…</Panel>;

  const set = (patch: Partial<BurninConfig>) => setDraft((d) => d && { ...d, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      const { config } = await api.put<{ config: BurninConfig }>('/api/admin/burnin', draft);
      setDraft(config);
      void qc.invalidateQueries({ queryKey: qk.admin('burnin') });
      toast.success(t('burnin.template.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('burnin.title')}>
      <p className="mb-3 text-xs text-muted-foreground">{t('burnin.hint2')}</p>
      <div className="space-y-2.5">
        {burninflags(t).map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={Boolean(draft[f.key])}
              onChange={(e) => set({ [f.key]: e.target.checked })}
            />
            <span className="font-medium">{f.label}</span>
            {f.hint && <span className="text-xs text-muted-foreground">({f.hint})</span>}
          </label>
        ))}
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{t('burnin.freeText')}</span>
          <Input
            value={draft.customText}
            onChange={(e) => set({ customText: e.target.value })}
            placeholder={t('burnin.freeText.placeholder')}
            aria-label={t('burnin.freeText.placeholder')}
            maxLength={120}
          />
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
