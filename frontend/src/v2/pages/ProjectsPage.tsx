import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Star, FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useProjectsQuery } from '../lib/queries';
import { useAuth } from '../stores/useAuth';
import type { Project, ProjectStatus } from '../types/api';
import Shell from '../components/Shell';
import ViewToggle from '../components/ViewToggle';
import { useViewMode } from '../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../components/EntityCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useFavorites } from '../stores/useFavorites';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Actif',
  ON_HOLD: 'En pause',
  COMPLETED: 'Terminé',
  ARCHIVED: 'Archivé',
};
const STATUS_OPTIONS: readonly ProjectStatus[] = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'ON_HOLD'
        ? 'warning'
        : status === 'COMPLETED'
          ? 'info'
          : ('muted' as const);
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export default function ProjectsPage() {
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const view = useViewMode('projects');
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'PROJECT' && f.entityId === id);
  const qc = useQueryClient();
  const { data: projects, error } = useProjectsQuery();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.projects });

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
        <h1 className="text-xl font-semibold">Projets</h1>
        <div className="flex items-center gap-2">
          {canManage && (
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
      ) : (
        <EntityContainer view={view}>
          {projects.map((p) => (
            <EntityCard
              key={p.id}
              to={`/projects/${p.id}`}
              view={view}
              title={p.name}
              subtitle={p.description ?? undefined}
              thumbnailUrl={p.thumbnailUrl}
              badge={<StatusBadge status={p.status} />}
              actions={[
                {
                  icon: (
                    <Star
                      size={15}
                      fill={isFav(p.id) ? 'currentColor' : 'none'}
                      className={isFav(p.id) ? 'text-warning' : ''}
                    />
                  ),
                  label: 'Favori',
                  onClick: () => toggleFav('PROJECT', p.id),
                },
                ...(canManage
                  ? [
                      { icon: EditIcon, label: 'Éditer', onClick: () => setEditing(p) },
                      { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(p) },
                    ]
                  : []),
              ]}
            />
          ))}
        </EntityContainer>
      )}

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

function EditProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState(project.status);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/api/projects/${project.id}`, { name, description: description || null, status });
      toast.success('Projet mis à jour');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={save} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Éditer le projet</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Statut</Label>
            <Select
              className="w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
