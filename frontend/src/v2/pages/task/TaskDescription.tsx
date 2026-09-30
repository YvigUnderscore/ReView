// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { useT } from '../../i18n';

/**
 * Consigne d'une tâche (Phase 50) : ce qu'il y a à faire.
 *
 * Le modèle n'avait aucun champ de description — nulle part dans la chaîne. L'artiste lisait
 * le nom de l'étape et devinait le reste, ou allait chercher un retour de review qui en
 * parlait peut-être.
 *
 * Éditable sur place, sans quitter la page ni ouvrir de panneau : le texte lui-même est la
 * zone cliquable. Seule la production écrit — c'est elle qui donne le travail ; l'assigné,
 * lui, ne peut changer que son statut et sa checklist, exactement comme le serveur
 * l'autorise. Vide et sans droit d'écrire, l'encart n'apparaît pas : un cadre vide n'apprend
 * rien à personne.
 */
export default function TaskDescription({
  taskId,
  description,
  canEdit,
}: {
  taskId: number;
  description: string | null | undefined;
  canEdit: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const text = description?.trim() ?? '';

  if (text === '' && !canEdit) return null;

  const startEditing = () => {
    setDraft(description ?? '');
    setEditing(true);
  };

  const save = async () => {
    const next = draft.trim();
    if (next === text) return setEditing(false);
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${taskId}`, { description: next === '' ? null : next });
      void qc.invalidateQueries({ queryKey: qk.task(taskId) });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="group mb-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileText size={15} /> {t('task.description')}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEditing}
            title={t('task.descriptionEdit')}
            aria-label={t('task.descriptionEdit')}
            className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            autoGrow
            minRows={4}
            maxRows={16}
            value={draft}
            maxLength={4000}
            placeholder={t('task.descriptionPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : text === '' ? (
        <button
          type="button"
          onClick={startEditing}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('task.descriptionEmpty')}
        </button>
      ) : canEdit ? (
        /* Le texte est sa propre zone d'édition : un clic ouvre la saisie là où l'œil est
           déjà. `text-left` parce qu'un bouton centre son contenu par défaut. */
        <button
          type="button"
          onClick={startEditing}
          className="w-full whitespace-pre-wrap text-left text-sm leading-relaxed text-foreground"
        >
          {text}
        </button>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>
      )}
    </section>
  );
}
