// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListVideo, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import type { PlaylistSummary } from '../types/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useT } from '../i18n';

/**
 * « Ajouter à la playlist » (Phase 33) : choisit une playlist du projet ou en crée
 * une, puis y ajoute des médias et/ou des versions (médias résolus en versions côté
 * serveur, dédupliqués). Ouvert depuis les clics droits : cartes Reviews (+ barre de
 * sélection), cartes de version (task/asset) et review courante.
 */
export default function AddToPlaylistDialog({
  open,
  onOpenChange,
  projectId,
  mediaIds = [],
  versionIds = [],
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: number | null;
  mediaIds?: number[];
  versionIds?: number[];
  onDone?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const listQ = useQuery({
    queryKey: qk.playlists(projectId ?? 0),
    queryFn: () =>
      api
        .get<{ playlists: PlaylistSummary[] }>(`/api/playlists?projectId=${projectId}`)
        .then((d) => d.playlists),
    enabled: open && projectId !== null,
  });
  const playlists = listQ.data ?? [];

  const finish = (added: number, skipped: number, name: string) => {
    toast.success(
      `${added} version${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à « ${name} »` +
        (skipped > 0 ? ` (${skipped} déjà présente${skipped > 1 ? 's' : ''})` : ''),
    );
    void qc.invalidateQueries({ queryKey: ['playlists'] });
    void qc.invalidateQueries({ queryKey: ['playlist'] });
    onOpenChange(false);
    setNewName('');
    onDone?.();
  };

  const targetCount = mediaIds.length + versionIds.length;
  const ids = {
    ...(mediaIds.length > 0 ? { mediaIds } : {}),
    ...(versionIds.length > 0 ? { versionIds } : {}),
  };

  const addToExisting = async (p: PlaylistSummary) => {
    setBusy(true);
    try {
      const out = await api.post<{ added: number; skipped: number }>(`/api/playlists/${p.id}/items`, ids);
      finish(out.added, out.skipped, p.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || projectId === null) return;
    setBusy(true);
    try {
      const { playlist } = await api.post<{ playlist: PlaylistSummary }>('/api/playlists', {
        projectId,
        name,
        ...ids,
      });
      finish(playlist._count.items, targetCount - playlist._count.items, name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reviews.addToPlaylistShort')}</DialogTitle>
        </DialogHeader>
        {projectId === null ? (
          <p className="text-sm text-muted-foreground">
            La sélection couvre plusieurs projets : une playlist appartient à un seul projet. Restreignez la
            sélection (filtre projet) puis réessayez.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {targetCount} élément{targetCount > 1 ? 's' : ''} — chaque version correspondante est ajoutée en
              fin de playlist.
            </p>
            {playlists.length > 0 && (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {playlists.map((p) => (
                  <li key={p.id}>
                    <button
                      disabled={busy}
                      onClick={() => void addToExisting(p)}
                      className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-secondary/60 disabled:opacity-50"
                    >
                      <ListVideo size={14} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {p._count.items} version{p._count.items > 1 ? 's' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void createAndAdd()}
                placeholder="Nouvelle playlist…"
              />
              <Button size="sm" disabled={busy || !newName.trim()} onClick={() => void createAndAdd()}>
                <Plus size={14} /> Créer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
