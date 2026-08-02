// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Checkbox } from '../../components/ui/checkbox';
import type { ChecklistItem } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Checklist d'une tâche (38.F) : cochable par l'assigné ou un manager, items ajoutables/
 * supprimables par un manager. Persistée via PATCH /api/tasks/:id { checklist }.
 */
export default function TaskChecklist({
  taskId,
  items,
  canToggle,
  canEditItems,
}: {
  taskId: number;
  items: ChecklistItem[];
  canToggle: boolean;
  canEditItems: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [adding, setAdding] = useState('');

  const save = async (next: ChecklistItem[]) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, { checklist: next });
      qc.invalidateQueries({ queryKey: qk.task(taskId) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const toggle = (i: number) => save(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  const removeItem = (i: number) => save(items.filter((_, idx) => idx !== i));
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const text = adding.trim();
    if (!text) return;
    setAdding('');
    void save([...items, { text, done: false }]);
  };

  if (items.length === 0 && !canEditItems) return null;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <ListChecks size={15} /> Checklist
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {doneCount}/{items.length}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="group flex items-center gap-2 text-sm">
            <Checkbox checked={it.done} disabled={!canToggle} onCheckedChange={() => toggle(i)} />
            <span className={it.done ? 'text-muted-foreground line-through' : ''}>{it.text}</span>
            {canEditItems && (
              <button
                onClick={() => removeItem(i)}
                title="Retirer"
                className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEditItems && (
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
            placeholder={t('kanban.addItem')}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <button className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs">
            <Plus size={12} /> Ajouter
          </button>
        </form>
      )}
    </section>
  );
}
