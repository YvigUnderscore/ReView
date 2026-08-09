// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Film, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import FavoriteButton from '../../components/FavoriteButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import MultiRowCreate from '../../components/MultiRowCreate';
import BatchGenerator from '../../components/BatchGenerator';
import { EditIcon, DeleteIcon } from '../../components/EntityCard';
import EmptyState from '../../components/ui/empty-state';
import { SkeletonRows } from '../../components/ui/skeleton';
import ModeSwitch, { type CreateMode } from './ModeSwitch';
import SequenceEditDialog from './SequenceEditDialog';
import TimelineCard from '../timeline/TimelineCard';
import { sortByCode, type Nomenclature, type Sequence, type SequenceDetailData } from './projectTypes';
import type { PipelineSettings } from '../../types/api';
import { useT } from '../../i18n';

/** Onglet Séquences : création (simple / lot / auto), édition (dialog), détail en accordéon. */
export default function SequencesTab({
  projectId,
  sequences,
  canManage,
  reload,
  focusId = null,
  onFocus,
  nomenclature,
  pipeline,
}: {
  projectId: number;
  sequences: Sequence[];
  canManage: boolean;
  reload: () => Promise<void>;
  focusId?: number | null;
  onFocus: (id: number | null) => void;
  nomenclature: Nomenclature;
  pipeline: PipelineSettings;
}) {
  const t = useT();
  const [newSeq, setNewSeq] = useState({ name: '', code: '' });
  const [mode, setMode] = useState<CreateMode>('simple');
  const [editing, setEditing] = useState<Sequence | null>(null);
  // Accordéon piloté par l'URL (?seq=ID) : back/forward et partage de lien cohérents (10.A6)
  const open = focusId;
  const [deleting, setDeleting] = useState<Sequence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortByCode(sequences);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/sequences', { projectId, code: newSeq.code, name: newSeq.name || newSeq.code });
      toast.success(t('sequences.created', { code: newSeq.code }));
      setNewSeq({ name: '', code: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/sequences/bulk', {
      projectId,
      items: rows.map((r) => ({ code: r.code, name: r.name || r.code })),
    });
    toast.success(t('sequences.createdCount', { count: rows.length }));
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/sequences/${deleting.id}`);
      toast.success(t('sequences.trashed'));
      setDeleting(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sequences.title')}</h2>
        {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && mode === 'auto' && (
        <BatchGenerator
          defaults={{
            prefix: nomenclature.sequencePrefix,
            step: nomenclature.step,
            padding: nomenclature.padding,
          }}
          onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name })))}
        />
      )}
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel="{t('sequences.create')}"
          fields={[
            {
              key: 'code',
              placeholder: t('sequences.codePlaceholder', {
                example: `${nomenclature.sequencePrefix}${'0'.repeat(nomenclature.padding)}`,
              }),
              className: 'w-32',
            },
            { key: 'name', placeholder: t('sequences.name.placeholder'), className: 'flex-1' },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form onSubmit={create} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
          <input
            className="w-28 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('sequences.code.placeholder')}
            value={newSeq.code}
            onChange={(e) => setNewSeq((s) => ({ ...s, code: e.target.value }))}
            required
          />
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('sequences.name.placeholder')}
            value={newSeq.name}
            onChange={(e) => setNewSeq((s) => ({ ...s, name: e.target.value }))}
          />
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">
            <Plus size={14} /> {t('entity.sequence')}
          </button>
        </form>
      )}
      {sequences.length === 0 ? (
        <EmptyState
          compact
          icon={Film}
          title={t('sequences.empty.title')}
          description={canManage ? t('sequences.empty.hint') : t('sequences.empty.description')}
        />
      ) : (
        <div className="space-y-1.5">
          {sorted.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-card">
              <div className="group flex items-center justify-between px-3 py-2">
                <button onClick={() => onFocus(open === s.id ? null : s.id)} className="text-left text-sm">
                  <span className="font-medium">{s.code}</span> · {s.name}
                </button>
                <div className="flex items-center gap-1">
                  <FavoriteButton type="SEQUENCE" entityId={s.id} />
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setEditing(s)}
                        title={t('common.edit')}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                      >
                        {EditIcon}
                      </button>
                      <button
                        onClick={() => setDeleting(s)}
                        title={t('common.delete')}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-secondary"
                      >
                        {DeleteIcon}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {open === s.id && <SequenceDetail sequenceId={s.id} projectId={projectId} />}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <SequenceEditDialog
          sequence={editing}
          pipeline={pipeline}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('sequences.delete.title')}
        message={t('sequences.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Détail d'une séquence : montage automatique, shots + assets assignés (chargé à l'ouverture)
function SequenceDetail({ sequenceId, projectId }: { sequenceId: number; projectId: number }) {
  const t = useT();
  const { data: seqData } = useQuery({
    queryKey: qk.sequence(sequenceId),
    queryFn: () => api.get<{ sequence: SequenceDetailData }>(`/api/sequences/${sequenceId}`),
  });
  const data = seqData?.sequence ?? null;

  if (!data)
    return (
      <div className="border-t border-border px-3 py-2">
        <SkeletonRows count={2} />
      </div>
    );
  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      {/* Le montage se met à jour à chaque publication : il est en tête, pas en annexe. */}
      <TimelineCard projectId={projectId} sequenceId={sequenceId} />
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Shots ({data.shots.length})
        </div>
        {data.shots.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('sequences.noShot')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.shots.map((sh) => (
              <span key={sh.id} className="rounded border border-border bg-background px-2 py-0.5 text-xs">
                {sh.code} <span className="text-muted-foreground">· {sh.name}</span>
                {sh.assets.length > 0 && (
                  <span className="ml-1 text-[10px] text-primary">{sh.assets.length} asset(s)</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sequences.assets', { count: data.assets.length })}
        </div>
        {data.assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('sequences.noAsset')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.assets.map((a) => (
              <Link
                key={a.id}
                to={`/assets/${a.id}`}
                className="rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary"
              >
                {a.name} <span className="text-muted-foreground">· {a.type}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
