// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import type { Project } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useT } from '../../i18n';

/**
 * Duplication de la structure d'un projet (38.A) : séquences/shots (+ tâches optionnelles),
 * sans médias ni versions. Sert aussi de « nouveau projet depuis un modèle ».
 */
export default function DuplicateProjectDialog({
  project,
  onClose,
  onDone,
}: {
  project: Project;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(t('projects.copyOf', { name: project.name }));
  const [includeTasks, setIncludeTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${project.id}/duplicate`, { name, includeTasks });
      toast.success(t('projects.duplicated', { name, source: project.name }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
      setBusy(false);
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
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{t('projects.duplicate')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{t('projects.newName')}</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeTasks} onCheckedChange={(v) => setIncludeTasks(v === true)} />
            {t('project.copyTasks')}
          </label>
          <p className="text-xs text-muted-foreground">{t('project.dupHint')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {t('common.duplicate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
