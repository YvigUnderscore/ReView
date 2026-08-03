// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Bell, BellOff, Clapperboard, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../../components/EntityCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import MultiRowCreate from '../../components/MultiRowCreate';
import BatchGenerator from '../../components/BatchGenerator';
import EmptyState from '../../components/ui/empty-state';
import ModeSwitch, { type CreateMode } from './ModeSwitch';
import ShotDetailDrawer from './ShotDetailDrawer';
import ShotEditDialog from './ShotEditDialog';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';
import type { PipelineSettings } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Onglet Shots : création (simple / lot / auto), cartes groupées par séquence,
 * détail d'un shot en drawer latéral (10.C1) piloté par l'URL (?shot=ID).
 */
export default function ShotsTab({
  projectId,
  sequences,
  shots,
  canManage,
  reload,
  focusId = null,
  onFocus,
  nomenclature,
  pipeline,
}: {
  projectId: number;
  sequences: Sequence[];
  shots: Shot[];
  canManage: boolean;
  reload: () => Promise<void>;
  focusId?: number | null;
  onFocus: (id: number | null) => void;
  nomenclature: Nomenclature;
  pipeline: PipelineSettings;
}) {
  const t = useT();
  const view = useViewMode(`shots:${projectId}`);
  // Suivi de notifications par shot (32.G, clic droit).
  const watch = useWatch();
  const [newShot, setNewShot] = useState({ name: '', code: '', sequenceId: '' });
  const [mode, setMode] = useState<CreateMode>('simple');
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drawer piloté par l'URL (?shot=ID) : back/forward et partage de lien cohérents (10.A6)
  const openShot = focusId != null ? (shots.find((s) => s.id === focusId) ?? null) : null;

  const sortedSequences = sortByCode(sequences);

  const createShot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/shots', {
        projectId,
        name: newShot.name || newShot.code,
        code: newShot.code,
        sequenceId: newShot.sequenceId ? Number(newShot.sequenceId) : null,
      });
      toast.success(t('shots.createdNamed', { code: newShot.code }));
      setNewShot({ name: '', code: '', sequenceId: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name || r.code,
        sequenceId: r.sequenceId ? Number(r.sequenceId) : null,
      })),
    });
    toast.success(t('shots.created', { count: rows.length }));
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/shots/${deleting.id}`);
      toast.success(t('shots.trashed'));
      setDeleting(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const groups = [
    ...sortedSequences.map((s) => ({
      seq: s as Sequence | null,
      list: shots.filter((sh) => sh.sequenceId === s.id),
    })),
    { seq: null as Sequence | null, list: shots.filter((sh) => sh.sequenceId === null) },
  ].filter((g) => g.list.length > 0 || g.seq);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('shots.title')}</h2>
        <div className="flex items-center gap-2">
          {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {canManage && mode === 'auto' && (
        <BatchGenerator
          defaults={{
            prefix: nomenclature.shotPrefix,
            step: nomenclature.step,
            padding: nomenclature.padding,
          }}
          sequences={sortedSequences}
          onSubmit={(items) =>
            createBulk(
              items.map((it) => ({
                code: it.code,
                name: it.name,
                sequenceId: it.sequenceId != null ? String(it.sequenceId) : '',
              })),
            )
          }
        />
      )}
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel={t('shots.create')}
          fields={[
            {
              key: 'code',
              placeholder: t('shots.codePlaceholder', {
                example: `${nomenclature.shotPrefix}${'0'.repeat(nomenclature.padding)}`,
              }),
              className: 'w-28',
            },
            { key: 'name', placeholder: t('sequences.name.placeholder'), className: 'flex-1' },
            {
              key: 'sequenceId',
              placeholder: t('shots.sequence'),
              className: 'w-44',
              options: [
                { value: '', label: t('shots.noSequence') },
                ...sortedSequences.map((sq) => ({ value: String(sq.id), label: `${sq.code} · ${sq.name}` })),
              ],
            },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form
          onSubmit={createShot}
          className="mb-5 flex flex-wrap gap-2 rounded-md border border-border bg-card p-2"
        >
          <input
            className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('sequences.code.placeholder')}
            value={newShot.code}
            onChange={(e) => setNewShot((s) => ({ ...s, code: e.target.value }))}
            required
          />
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('sequences.name.placeholder')}
            value={newShot.name}
            onChange={(e) => setNewShot((s) => ({ ...s, name: e.target.value }))}
          />
          <select
            className="rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={newShot.sequenceId}
            onChange={(e) => setNewShot((s) => ({ ...s, sequenceId: e.target.value }))}
          >
            <option value="">{t('shots.noSequence')}</option>
            {sortedSequences.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.code} · {sq.name}
              </option>
            ))}
          </select>
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">
            <Plus size={14} /> Shot
          </button>
        </form>
      )}

      {shots.length === 0 && (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('shots.empty.title')}
          description={canManage ? t('shots.empty.hint') : t('shots.empty.description')}
        />
      )}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.seq ? `${g.seq.code} · ${g.seq.name}` : t('shots.noSequence')}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => {
              const actions = canManage
                ? [
                    { icon: EditIcon, label: t('common.edit'), onClick: () => setEditing(shot) },
                    {
                      icon: DeleteIcon,
                      label: t('common.delete'),
                      danger: true,
                      onClick: () => setDeleting(shot),
                    },
                  ]
                : [];
              // Suivi (32.G) : action de clic droit uniquement (UI simple).
              const watching = watch.isWatching('SHOT', shot.id);
              const watchAction = {
                icon: watching ? <BellOff size={14} /> : <Bell size={14} />,
                label: watching ? t('shots.unwatch') : t('shots.watch'),
                onClick: () => watch.toggle('SHOT', shot.id),
              };
              return (
                <EntityCard
                  key={shot.id}
                  view={view}
                  onClick={() => onFocus(focusId === shot.id ? null : shot.id)}
                  active={focusId === shot.id}
                  title={`${shot.code} · ${shot.name}`}
                  subtitle={
                    t('task.count', { count: shot._count?.tasks ?? 0 }) +
                    (shot.assets?.length ? ` · ${t('assets.count', { count: shot.assets.length })}` : '')
                  }
                  thumbnailUrl={shot.thumbnailUrl}
                  favorite={{ type: 'SHOT', entityId: shot.id }}
                  actions={actions}
                  contextActions={[watchAction, ...actions]}
                />
              );
            })}
          </EntityContainer>
        </section>
      ))}

      {/* Détail du shot ouvert : drawer latéral (remplace l'accordéon inline) */}
      <ShotDetailDrawer
        shot={openShot}
        projectId={projectId}
        canManage={canManage}
        onClose={() => onFocus(null)}
        reload={reload}
      />

      {editing && (
        <ShotEditDialog
          shot={editing}
          sequences={sortedSequences}
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
        title={t('shots.delete.title')}
        message={t('shots.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
