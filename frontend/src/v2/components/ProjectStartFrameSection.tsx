// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { api } from '../../lib/apiClient';
import { useT } from '../i18n';
import { Card } from './ui/card';

/**
 * Frame de départ du projet (déplacée dans les réglages depuis la vue d'ensemble).
 *
 * Elle n'appartient pas au brouillon de réglages : c'est un champ du projet lui-même, qui
 * s'enregistre seul — comme le quota de stockage, et avec le même retour d'écran.
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
    <Card>
      <div className="text-sm font-medium">{t('pipeline.startFrame')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('project.startFrameHint')}</div>
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
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {msg && <p className="mt-2 text-xs text-success">{msg}</p>}
    </Card>
  );
}
