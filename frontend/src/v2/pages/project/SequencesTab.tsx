// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Film, ExternalLink, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import FavoriteButton from '../../components/FavoriteButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import BatchGenerator from '../../components/BatchGenerator';
import EmptyState from '../../components/ui/empty-state';
import EntityContextMenu from '../../components/ui/entity-menu';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { entriesOf, separator, type MenuEntry } from '../../lib/menuSpec';
import { useStatusMenu } from '../../lib/useStatusMenu';
import TimelineCard from '../timeline/TimelineCard';
import { sortByCode, type Nomenclature, type Sequence } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';

/**
 * Onglet Séquences (C3).
 *
 * Le montage du film entier ouvre l'onglet — il vivait dans la vue d'ensemble, loin des
 * séquences qui le composent. Chaque séquence est devenue une ligne qui mène à sa page :
 * l'accordéon rechargeait un détail à chaque dépliage, et cachait le montage de la
 * séquence derrière deux clics. Les réglages s'ouvrent au clic droit, comme partout.
 */
export default function SequencesTab({
  projectId,
  sequences,
  canManage,
  reload,
  nomenclature,
}: {
  projectId: number;
  sequences: Sequence[];
  canManage: boolean;
  reload: () => Promise<void>;
  nomenclature: Nomenclature;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [deleting, setDeleting] = useState<Sequence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sgLinks = useSgLinks(projectId);
  const sorted = sortByCode(sequences);
  // Statut par clic droit — même vocabulaire que sur les plans et le kanban.
  const { entry: statusEntry } = useStatusMenu(projectId, 'sequence');

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
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const menuFor = (s: Sequence): MenuEntry[] => [
    { id: 'open', label: t('sequences.open'), onSelect: () => void navigate(`/sequences/${s.id}`) },
    ...entriesOf(statusEntry(s, { canEdit: canManage })),
    ...(canManage
      ? [
          separator('manage'),
          {
            id: 'settings',
            label: t('entity.settings.open'),
            icon: <Settings2 size={14} />,
            onSelect: () => setEditing(s),
          },
          {
            id: 'delete',
            label: t('common.moveToTrash'),
            icon: <Trash2 size={14} />,
            onSelect: () => setDeleting(s),
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Montage du film entier (45) : toutes les séquences bout à bout, tenu à jour seul. */}
      <TimelineCard projectId={projectId} sequenceId={null} />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sequences.title')}</h2>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && (
        <BatchGenerator
          defaults={{
            prefix: nomenclature.sequencePrefix,
            step: nomenclature.step,
            padding: nomenclature.padding,
          }}
          onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name })))}
        />
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
            <EntityContextMenu key={s.id} entries={menuFor(s)}>
              <div className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-primary">
                <Link to={`/sequences/${s.id}`} className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="font-medium group-hover:text-primary">{s.code}</span>
                  {/* Le nom ne s'affiche que s'il apporte quelque chose : la plupart des
                      séquences importées portent leur code en guise de nom. */}
                  {s.name !== s.code && <span className="truncate text-muted-foreground">{s.name}</span>}
                  <PipelineStatusBadge statusId={s.pipelineStatusId} scope="sequence" size="xs" />
                  {s._count.shots > 0 && (
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {t('sequence.shotCount', { count: s._count.shots })}
                    </span>
                  )}
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <SgSyncDot projectId={projectId} type="sequence" localId={s.id} canRealign={canManage} />
                  {/* Fiche ShotGrid — uniquement si la séquence y est reliée. */}
                  {sgLinks.linkFor('sequence', s.id) && (
                    <a
                      href={sgLinks.linkFor('sequence', s.id)!}
                      target="_blank"
                      rel="noreferrer"
                      title={t('shotgrid.openIn.sequence')}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                  <FavoriteButton type="SEQUENCE" entityId={s.id} />
                </div>
              </div>
            </EntityContextMenu>
          ))}
        </div>
      )}

      {editing && (
        <EntitySettingsDialog
          kind="sequence"
          id={editing.id}
          projectId={projectId}
          entity={editing}
          thumbnailUrl={editing.thumbnailUrl}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
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
