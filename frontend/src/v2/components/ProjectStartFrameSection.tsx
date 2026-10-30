// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { api } from '../../lib/apiClient';
import { useT } from '../i18n';
import { Hash } from 'lucide-react';
import { Hint } from './ui/hint';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';

/**
 * Project start frame (moved into the settings from the overview).
 *
 * It does not belong to the settings draft: it is a field of the project itself, which
 * saves on its own, like the storage quota, and with the same on-screen feedback.
 */
export default function ProjectStartFrameSection({
  projectId,
  startFrame,
  onStartFrameChange,
}: {
  projectId: number;
  startFrame: number;
  onStartFrameChange: (n: number) => void;
}) {
  const t = useT();
  const [frameVal, setFrameVal] = useState(String(startFrame));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(frameVal);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await api.patch(`/api/projects/${projectId}`, { startFrame: n });
      onStartFrameChange(n);
      setMsg(t('project.startFrameSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title={t('pipeline.startFrame')}
      hint={t('project.startFrameHint')}
      icon={Hash}
      tone="primary"
      keywords={SETTINGS_KEYWORDS.startFrame}
    >
      <div className="flex items-center gap-2">
        <input
          type="number"
          aria-label={t('pipeline.startFrame')}
          className="w-28 rounded border border-input bg-background px-2 py-1.5 text-sm"
          value={frameVal}
          onChange={(e) => setFrameVal(e.target.value)}
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          {saving ? '…' : t('common.save')}
        </button>
      </div>
      {error && <Hint tone="error">{error}</Hint>}
      {msg && <Hint tone="success">{msg}</Hint>}
    </SettingsCard>
  );
}
