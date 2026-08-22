// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { SkeletonRows } from './ui/skeleton';
import { useT } from '../i18n';
import type { ProjectSettings } from '../types/api';
import {
  inheritanceRows,
  overrideKey,
  revertPatch,
  type InheritanceRow,
  type ProjectSettingsOverrideView,
  type ProjectSettingsPatch,
} from '../lib/projectInheritance';

/**
 * Panneau « Héritage du studio » des réglages projet.
 *
 * Rien ne disait à l'écran ce que le projet possède en propre et ce qu'il ne fait
 * qu'hériter : les deux se lisaient dans les mêmes champs. Une section est ici soit héritée
 * du studio — et elle suivra ses évolutions — soit surchargée ici, auquel cas on peut la
 * rendre d'un geste.
 */

export default function ProjectSettingsInheritance({
  projectId,
  onReverted,
}: {
  projectId: number;
  /**
   * Le brouillon de l'onglet part des réglages effectifs : rendre une section au studio les
   * change, on lui repasse donc ceux que le serveur vient de recalculer.
   */
  onReverted: (settings: ProjectSettings) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const viewQ = useQuery({
    queryKey: overrideKey(projectId),
    queryFn: () => api.get<ProjectSettingsOverrideView>(`/api/projects/${projectId}/settings/override`),
  });

  const revert = useMutation({
    mutationFn: (patch: ProjectSettingsPatch) =>
      api.patch<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`, patch),
    onSuccess: async (data) => {
      setError(null);
      setMessage(t('inheritance.reverted'));
      // `qk.project` couvre les réglages effectifs ET cette vue d'override.
      await qc.invalidateQueries({ queryKey: qk.project(projectId) });
      onReverted(data.settings);
    },
    onError: (e: unknown) => {
      setMessage(null);
      setError(e instanceof Error ? e.message : t('common.error.generic'));
    },
  });

  const overrides = new Set(viewQ.data?.overrides ?? []);
  const rows = inheritanceRows(t, viewQ.data?.studio);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-medium">{t('inheritance.title')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('inheritance.hint')}</div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {message && <p className="mb-2 text-sm text-success">{message}</p>}
      {viewQ.data ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <InheritanceLine
              key={row.id}
              row={row}
              overridden={row.sections.some((section) => overrides.has(section))}
              busy={revert.isPending}
              onRevert={() => revert.mutate(revertPatch(row.sections))}
            />
          ))}
        </ul>
      ) : (
        <SkeletonRows count={4} />
      )}
    </section>
  );
}

function InheritanceLine({
  row,
  overridden,
  busy,
  onRevert,
}: {
  row: InheritanceRow;
  overridden: boolean;
  busy: boolean;
  onRevert: () => void;
}) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="flex-1 text-sm">{row.label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-2xs uppercase tracking-wide ${
          overridden ? 'bg-warning/15 text-warning' : 'bg-secondary text-muted-foreground'
        }`}
      >
        {overridden ? t('inheritance.overridden') : t('inheritance.inherited')}
      </span>
      {row.studioValue && (
        <span className="text-2xs text-muted-foreground">
          {t('inheritance.studioValue', { value: row.studioValue })}
        </span>
      )}
      {overridden && (
        <button
          type="button"
          onClick={onRevert}
          disabled={busy}
          title={t('inheritance.revert')}
          aria-label={`${t('inheritance.revert')} — ${row.label}`}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Undo2 size={13} /> {t('inheritance.revert')}
        </button>
      )}
    </li>
  );
}
