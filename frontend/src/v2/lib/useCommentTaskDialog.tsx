// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { excerpt } from './richText';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { useT } from '../i18n';

/**
 * « Créer une tâche depuis ce retour » — en passant par un nommage (Phase 50).
 *
 * Le nom était imposé : le texte du retour, tronqué. C'est ce nom que la production relit
 * ensuite sur le kanban, dans le pipe et — sur un projet relié — sur le site ShotGrid, où
 * « le raccord saute de deux frames, voir la tête de Léa » ne veut plus rien dire. On le
 * demande donc, avec le texte du retour en proposition de départ, et l'on ajoute la
 * consigne dans le même mouvement : c'est le moment où l'on sait ce qu'il y a à faire.
 *
 * Le dialogue vit ici plutôt que dans le fil de commentaires : le fil ne fait que
 * l'ouvrir, et la création (avec ses droits, son étape et son statut) est une affaire de
 * tâches.
 */

/** Ce que le fil connaît du retour à transformer. */
export interface CommentTaskSource {
  id: number;
  content: string;
}

export function useCommentTaskDialog(): {
  /** Ouvre le dialogue pour ce retour. */
  open: (comment: CommentTaskSource) => void;
  /** À rendre une fois dans l'écran appelant. */
  dialog: ReactNode;
} {
  const t = useT();
  const navigate = useNavigate();
  const [source, setSource] = useState<CommentTaskSource | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (comment: CommentTaskSource) => {
    setSource(comment);
    // Proposition de départ : le retour lui-même, coupé sur un mot. Elle est *modifiable*,
    // et c'est tout le propos — un repli imposé n'apprend rien à personne.
    setName(excerpt(comment.content, 80));
    setDescription('');
  };

  const close = () => {
    setSource(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!source || name.trim().length === 0) return;
    setBusy(true);
    try {
      const { task } = await api.post<{ task: { id: number; name: string } }>(
        `/api/comments/${source.id}/task`,
        { name: name.trim(), description: description.trim() || null },
      );
      close();
      toast.success(t('task.createdNamed', { name: task.name }), {
        action: {
          label: t('common.open'),
          onClick: () => {
            void navigate(`/tasks/${task.id}`);
          },
        },
      });
    } catch (err) {
      // L'erreur la plus attendue est le nom déjà pris à cette étape : le dialogue reste
      // ouvert, avec le nom saisi, pour qu'il suffise d'en changer.
      setBusy(false);
      toast.error(err instanceof Error ? err.message : t('version.createFailed'));
    }
  };

  const dialog = (
    <Dialog
      open={source !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('task.fromComment.title')}</DialogTitle>
          <DialogDescription>{t('task.fromComment.hint')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('task.nameLabel')}</span>
            <input
              autoFocus
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('task.description')}</span>
            <Textarea
              autoGrow
              minRows={3}
              maxRows={8}
              value={description}
              maxLength={4000}
              placeholder={t('task.descriptionPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy || name.trim().length === 0}>
              {t('task.fromComment.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
