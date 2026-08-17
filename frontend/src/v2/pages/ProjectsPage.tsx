// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, Trash2, FolderOpen, ArchiveRestore, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useProjectsQuery, useArchivedProjectsQuery } from '../lib/queries';
import { projectPath } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import type { Project } from '../types/api';
import Shell from '../components/Shell';
import ViewToggle from '../components/ViewToggle';
import { useViewMode } from '../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../components/EntityCard';
import type { EntityItemAction } from '../components/EntityCard';
import ConfirmDialog from '../components/ConfirmDialog';
import SelectionBar from '../components/ui/selection-bar';
import { useMultiSelect } from '../lib/useMultiSelect';
import { bulkDelete } from '../lib/bulkApi';
import EditProjectModal from './projects/EditProjectModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';
import ProjectStatusBadge from './projects/ProjectStatusBadge';
import ProjectsTabs from './projects/ProjectsTabs';
import DuplicateProjectDialog from './projects/DuplicateProjectDialog';
import { useT } from '../i18n';

export default function ProjectsPage() {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const view = useViewMode('projects');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const active = useProjectsQuery();
  const archived = useArchivedProjectsQuery(tab === 'archived');
  const { data: projects, error } = tab === 'archived' ? archived : active;
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [duplicating, setDuplicating] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const sel = useMultiSelect(projects?.map((p) => p.id) ?? []);
  // Une (dés)archivage change les deux listes : on invalide les deux clés.
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.projectsArchived });
  };

  const restore = async (p: Project) => {
    try {
      await api.patch(`/api/projects/${p.id}`, { status: 'ACTIVE' });
      toast.success(t('projects.unarchived', { name: p.name }));
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('projects', sel.ids);
      toast.success(t('projects.trashedCount', { count }));
      sel.clear();
      setBulkDeleting(false);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/api/projects', { name });
      toast.success(t('projects.created', { name }));
      setName('');
      setCreating(false);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/projects/${deleting.id}`);
      toast.success(t('projects.trashed'));
      setDeleting(null);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('nav.projects')}</h1>
          {canManage && <ProjectsTabs tab={tab} onChange={setTab} />}
        </div>
        <div className="flex items-center gap-2">
          {canManage && tab === 'active' && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> {t('common.create')}
            </Button>
          )}
          <ViewToggle contextKey="projects" />
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={create} className="space-y-3">
            <DialogHeader>
              <DialogTitle>{t('projects.new')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>{t('projects.name')}</Label>
              <Input
                autoFocus
                placeholder={t('projects.name.placeholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm">
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {projects === undefined ? (
        <SkeletonCards />
      ) : projects.length === 0 ? (
        tab === 'archived' ? (
          <EmptyState
            icon={FolderKanban}
            title={t('projects.empty.archived.title')}
            description={t('projects.empty.archived.description')}
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title={t('projects.empty.title')}
            description={canManage ? t('projects.empty.canManage') : t('projects.empty.member')}
            action={canManage ? t('projects.empty.action') : undefined}
            onAction={() => setCreating(true)}
          />
        )
      ) : (
        <EntityContainer view={view}>
          {projects.map((p) => {
            const manageActions: EntityItemAction[] = !canManage
              ? []
              : tab === 'archived'
                ? [
                    {
                      icon: <ArchiveRestore size={15} />,
                      label: t('projects.unarchive'),
                      onClick: () => void restore(p),
                    },
                  ]
                : [
                    { icon: EditIcon, label: t('common.edit'), onClick: () => setEditing(p) },
                    {
                      icon: DeleteIcon,
                      label: t('common.delete'),
                      danger: true,
                      onClick: () => setDeleting(p),
                    },
                  ];
            return (
              <EntityCard
                key={p.id}
                to={projectPath(p)}
                view={view}
                title={p.name}
                subtitle={p.description ?? undefined}
                thumbnailUrl={p.thumbnailUrl}
                badge={<ProjectStatusBadge status={p.status} />}
                selection={{ selected: sel.isSelected(p.id), onSelect: (m) => sel.onSelect(p.id, m) }}
                favorite={{ type: 'PROJECT', entityId: p.id }}
                actions={manageActions}
                contextActions={[
                  {
                    icon: <FolderOpen size={14} />,
                    label: t('common.open'),
                    onClick: () => void navigate(projectPath(p)),
                  },
                  ...(canManage && tab === 'active'
                    ? [
                        {
                          icon: <Copy size={14} />,
                          label: t('common.duplicate'),
                          onClick: () => setDuplicating(p),
                        },
                      ]
                    : []),
                  ...manageActions,
                ]}
              />
            );
          })}
        </EntityContainer>
      )}

      {canManage && tab === 'active' && (
        <SelectionBar
          count={sel.count}
          label={t('projects.countLabel', { count: sel.count })}
          onClear={sel.clear}
          actions={[
            {
              label: t('common.delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={bulkDeleting}
        title={t('projects.deleteMany.title')}
        message={t('projects.deleteMany.message', { count: sel.count })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />

      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {duplicating && (
        <DuplicateProjectDialog
          project={duplicating}
          onClose={() => setDuplicating(null)}
          onDone={() => {
            setDuplicating(null);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('projects.delete.title')}
        message={t('projects.delete.message', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Shell>
  );
}
