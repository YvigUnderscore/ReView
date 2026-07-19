import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Star, FolderKanban, Trash2, FolderOpen, ArchiveRestore } from 'lucide-react';
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
import { useFavorites } from '../stores/useFavorites';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';
import ProjectStatusBadge from './projects/ProjectStatusBadge';
import ProjectsTabs from './projects/ProjectsTabs';

export default function ProjectsPage() {
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const view = useViewMode('projects');
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'PROJECT' && f.entityId === id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const active = useProjectsQuery();
  const archived = useArchivedProjectsQuery(tab === 'archived');
  const { data: projects, error } = tab === 'archived' ? archived : active;
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const sel = useMultiSelect(projects?.map((p) => p.id) ?? []);
  // Une (dés)archivage change les deux listes : on invalide les deux clés.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.projects });
    qc.invalidateQueries({ queryKey: qk.projectsArchived });
  };

  const restore = async (p: Project) => {
    try {
      await api.patch(`/api/projects/${p.id}`, { status: 'ACTIVE' });
      toast.success(`Projet « ${p.name} » désarchivé`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('projects', sel.ids);
      toast.success(`${count} projet(s) déplacé(s) dans la corbeille`);
      sel.clear();
      setBulkDeleting(false);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/api/projects', { name });
      toast.success(`Projet « ${name} » créé`);
      setName('');
      setCreating(false);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/projects/${deleting.id}`);
      toast.success('Projet déplacé dans la corbeille');
      setDeleting(null);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Projets</h1>
          {canManage && <ProjectsTabs tab={tab} onChange={setTab} />}
        </div>
        <div className="flex items-center gap-2">
          {canManage && tab === 'active' && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> Créer
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
              <DialogTitle>Nouveau projet</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>Nom du projet</Label>
              <Input
                autoFocus
                placeholder="Mon projet"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                Annuler
              </Button>
              <Button type="submit" size="sm">
                Créer
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
            title="Aucun projet archivé"
            description="Les projets que vous archivez (via Éditer → statut « Archivé ») apparaîtront ici, en lecture seule."
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="Aucun projet pour l'instant"
            description={
              canManage
                ? 'Créez votre premier projet avec le bouton « + Créer » pour organiser vos séquences, shots et assets.'
                : 'Vous n’êtes membre d’aucun projet. Demandez à un superviseur de vous ajouter.'
            }
            action={canManage ? 'Créer un projet' : undefined}
            onAction={() => setCreating(true)}
          />
        )
      ) : (
        <EntityContainer view={view}>
          {projects.map((p) => {
            const favAction: EntityItemAction = {
              icon: (
                <Star
                  size={15}
                  fill={isFav(p.id) ? 'currentColor' : 'none'}
                  className={isFav(p.id) ? 'text-warning' : ''}
                />
              ),
              label: 'Favori',
              onClick: () => toggleFav('PROJECT', p.id),
            };
            const manageActions: EntityItemAction[] = !canManage
              ? []
              : tab === 'archived'
                ? [
                    {
                      icon: <ArchiveRestore size={15} />,
                      label: 'Désarchiver',
                      onClick: () => restore(p),
                    },
                  ]
                : [
                    { icon: EditIcon, label: 'Éditer', onClick: () => setEditing(p) },
                    { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(p) },
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
                actions={[favAction, ...manageActions]}
                contextActions={[
                  {
                    icon: <FolderOpen size={14} />,
                    label: 'Ouvrir',
                    onClick: () => navigate(projectPath(p)),
                  },
                  favAction,
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
          label="projet(s)"
          onClear={sel.clear}
          actions={[
            {
              label: 'Supprimer',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={bulkDeleting}
        title="Supprimer les projets ?"
        message={
          <>{sel.count} projet(s) seront déplacés dans la corbeille. Restaurables depuis l'administration.</>
        }
        confirmLabel="Mettre à la corbeille"
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

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le projet ?"
        message={
          <>
            Le projet « {deleting?.name} » sera déplacé dans la corbeille. Vous pourrez le restaurer depuis
            l'administration.
          </>
        }
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Shell>
  );
}
