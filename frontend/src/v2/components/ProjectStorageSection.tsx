// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { SkeletonRows } from './ui/skeleton';

interface Usage {
  usage: number;
  quota: number | null;
}

/** Formate un nombre d'octets en Ko/Mo/Go/To (base 1024). */
function formatBytes(n: number): string {
  if (n <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const GB = 1024 ** 3;

/**
 * Quota & usage de stockage du projet (38.D) : jauge de consommation + réglage du quota en
 * Go (vide = illimité). Réservé aux gestionnaires (l'onglet Réglages ne s'ouvre qu'à eux).
 */
export default function ProjectStorageSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.projectUsage(projectId),
    queryFn: () => api.get<Usage>(`/api/projects/${projectId}/usage`),
  });
  const [quotaGb, setQuotaGb] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Valeur d'édition : initialisée depuis le quota courant à la première donnée reçue.
  const gbValue = quotaGb ?? (data ? (data.quota != null ? String(+(data.quota / GB).toFixed(2)) : '') : '');

  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const trimmed = gbValue.trim();
      const storageQuota = trimmed === '' ? null : Math.round(Number(trimmed) * GB);
      if (storageQuota != null && !Number.isFinite(storageQuota)) throw new Error('Quota invalide');
      await api.patch(`/api/projects/${projectId}`, { storageQuota });
      await qc.invalidateQueries({ queryKey: qk.projectUsage(projectId) });
      setMsg('Quota enregistré.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const pct = data && data.quota ? Math.min(100, Math.round((data.usage / data.quota) * 100)) : null;
  const over = pct != null && pct >= 100;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-medium">Stockage</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Consommation des médias du projet et quota (laisser vide = illimité).
      </div>
      {!data ? (
        <SkeletonRows count={2} />
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{formatBytes(data.usage)}</span>
            {data.quota != null ? ` / ${formatBytes(data.quota)}` : ' utilisés (illimité)'}
            {pct != null && ` — ${pct}%`}
          </div>
          {data.quota != null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${over ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Quota (Go)
              <input
                type="number"
                min={0}
                step="0.5"
                placeholder="illimité"
                className="w-28 rounded border border-input bg-background px-2 py-1.5 text-xs"
                value={gbValue}
                onChange={(e) => setQuotaGb(e.target.value)}
              />
            </label>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Save size={14} /> {saving ? '…' : 'Enregistrer'}
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {msg && <p className="text-xs text-success">{msg}</p>}
        </div>
      )}
    </section>
  );
}
