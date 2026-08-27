// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { useCandidates, type PlaylistCandidate } from '../../lib/playlistApi';
import { useSequencesQuery } from '../../lib/queries';
import { useDepartments } from '../../lib/departmentsApi';
import { useT } from '../../i18n';

/**
 * Catalogue du projet, à gauche de la playlist (C5).
 *
 * Monter une playlist obligeait à ouvrir chaque plan un par un pour y cliquer
 * « ajouter » : il n'existait aucune vue d'où choisir. On y cherche, on y filtre, et on
 * ajoute d'un clic — ou plusieurs d'un coup après sélection.
 *
 * « Dernière version seulement » est coché par défaut : une playlist de dailies montre
 * l'état courant du travail, pas l'historique de chaque tâche.
 */
export default function PlaylistCatalog({
  projectId,
  presentVersionIds,
  onAdd,
  busy,
}: {
  projectId: number;
  /** Ce que la playlist contient déjà : on le signale au lieu de le proposer deux fois. */
  presentVersionIds: ReadonlySet<number>;
  onAdd: (versionIds: number[]) => void;
  busy: boolean;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [department, setDepartment] = useState('');
  const [latestOnly, setLatestOnly] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const sequencesQ = useSequencesQuery(projectId);
  const departmentsQ = useDepartments(projectId, projectId > 0);
  const candidatesQ = useCandidates(projectId, { q, sequenceId, department, latestOnly });
  const candidates = candidatesQ.data ?? [];

  const toggle = (versionId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });

  const addSelected = () => {
    onAdd([...selected]);
    setSelected(new Set());
  };

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-border">
      <header className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('playlist.catalog.search')}
              aria-label={t('playlist.catalog.search')}
              className="h-9 w-full pl-8"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={latestOnly}
              onChange={(e) => setLatestOnly(e.target.checked)}
            />
            {t('playlist.catalog.latestOnly')}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="py-1.5">
            <option value="">{t('task.allSequences')}</option>
            <option value="none">{t('tree.outsideSequence')}</option>
            {(sequencesQ.data?.sequences ?? []).map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.code}
              </option>
            ))}
          </Select>
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="py-1.5">
            <option value="">{t('filters.allDepartments')}</option>
            {(departmentsQ.data ?? []).map((d) => (
              <option key={d.id} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
          {selected.size > 0 && (
            <Button size="sm" disabled={busy} onClick={addSelected} className="ml-auto">
              <Plus size={14} /> {t('playlist.catalog.addSelected', { count: selected.size })}
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {candidatesQ.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{t('playlist.catalog.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {candidates.map((c) => (
              <CandidateRow
                key={c.versionId}
                candidate={c}
                present={presentVersionIds.has(c.versionId)}
                selected={selected.has(c.versionId)}
                onToggle={() => toggle(c.versionId)}
                onAdd={() => onAdd([c.versionId])}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CandidateRow({
  candidate,
  present,
  selected,
  onToggle,
  onAdd,
  busy,
}: {
  candidate: PlaylistCandidate;
  present: boolean;
  selected: boolean;
  onToggle: () => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <li
      className={`flex items-center gap-2 rounded-md border p-1.5 transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary/50'
      }`}
    >
      <input
        type="checkbox"
        className="accent-primary"
        checked={selected}
        onChange={onToggle}
        aria-label={candidate.name}
      />
      {candidate.media?.thumbnailUrl ? (
        <img
          src={candidate.media.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-9 w-16 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="h-9 w-16 shrink-0 rounded bg-secondary" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{candidate.location || candidate.name}</span>
        <span className="block truncate text-2xs text-muted-foreground">{candidate.name}</span>
      </span>
      {candidate.reviewStatus && <ReviewDecisionBadge status={candidate.reviewStatus} />}
      {present ? (
        <span className="shrink-0 px-2 text-2xs text-muted-foreground">{t('playlist.catalog.present')}</span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          title={t('playlist.catalog.add')}
          aria-label={t('playlist.catalog.add')}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Plus size={15} />
        </button>
      )}
    </li>
  );
}
