// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import type { TranscodeConfig } from '../../types/api';
import { useT } from '../../i18n';

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'];

/** Contexte Vidéo (admin) : configuration du transcodage HLS lue par le worker (Phase 22/23). */
export default function TranscodeTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('transcode'),
    queryFn: () => api.get<{ config: TranscodeConfig }>('/api/admin/transcode').then((d) => d.config),
  });
  const [draft, setDraft] = useState<TranscodeConfig | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft(data);
  if (!draft) return <SkeletonRows count={4} />;

  const set = (patch: Partial<TranscodeConfig>) => setDraft((d) => d && { ...d, ...patch });
  const setRung = (i: number, k: 'height' | 'videoBitrateK', v: string) =>
    setDraft(
      (d) => d && { ...d, ladder: d.ladder.map((r, idx) => (idx === i ? { ...r, [k]: Number(v) || 0 } : r)) },
    );

  const save = async () => {
    setBusy(true);
    try {
      const { config } = await api.put<{ config: TranscodeConfig }>('/api/admin/transcode', draft);
      setDraft(config);
      void qc.invalidateQueries({ queryKey: qk.admin('transcode') });
      toast.success(t('transcode.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={draft.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span className="font-medium">{t('transcode.adaptiveHls')}</span>
        <span className="text-xs text-muted-foreground">{t('transcode.singleProxy')}</span>
      </label>

      {/* Scene detection (34.H) : opt-in — une passe d'analyse FFmpeg en plus par vidéo. */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={draft.sceneDetection ?? false}
          onChange={(e) => set({ sceneDetection: e.target.checked })}
        />
        <span className="font-medium">{t('transcode.sceneDetect')}</span>
        <span className="text-xs text-muted-foreground">{t('transcode.sceneDetect')}</span>
      </label>

      <Panel title={t('transcode.encoding')}>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <Field label={t('transcode.crf')}>
            <Input
              type="number"
              min={0}
              max={51}
              className="w-20 py-1.5"
              value={String(draft.crf)}
              onChange={(e) => set({ crf: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('transcode.preset')}>
            <Select className="py-1.5" value={draft.preset} onChange={(e) => set({ preset: e.target.value })}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('transcode.audioKbps')}>
            <Input
              type="number"
              className="w-24 py-1.5"
              value={String(draft.audioBitrateK)}
              onChange={(e) => set({ audioBitrateK: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('transcode.maxPx')}>
            <Input
              type="number"
              className="w-24 py-1.5"
              value={String(draft.maxHeight)}
              onChange={(e) => set({ maxHeight: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title={t('transcode.renditions')}>
        <div className="space-y-1.5">
          {draft.ladder.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Input
                type="number"
                className="w-24 py-1.5"
                value={String(r.height)}
                onChange={(e) => setRung(i, 'height', e.target.value)}
              />
              <span className="text-muted-foreground">px ·</span>
              <Input
                type="number"
                className="w-28 py-1.5"
                value={String(r.videoBitrateK)}
                onChange={(e) => setRung(i, 'videoBitrateK', e.target.value)}
              />
              <span className="text-muted-foreground">kbps</span>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => set({ ladder: draft.ladder.filter((_, idx) => idx !== i) })}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={() => set({ ladder: [...draft.ladder, { height: 720, videoBitrateK: 2500 }] })}
          >
            <Plus size={14} /> {t('transcode.rendition')}
          </Button>
        </div>
      </Panel>

      <Button onClick={save} disabled={busy}>
        <Save size={15} /> {busy ? 'Enregistrement…' : t('common.save')}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
