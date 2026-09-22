// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
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
 * Le nom était d'abord imposé : le texte du retour, tronqué. C'est ce nom que la production
 * relit ensuite sur le kanban, dans le pipe et — sur un projet relié — sur le site ShotGrid,
 * où « le raccord saute de deux frames, voir la tête de Léa » ne veut plus rien dire.
 *
 * Le proposer en point de départ ne réglait rien (lot 13) : les deux champs étaient à
 * l'envers. Le retour n'est pas un titre, c'est la **consigne** — ce qu'il y a à faire, et il
 * doit y aller en entier, pas coupé à quatre-vingts signes. Le nom, lui, est justement ce
 * qu'on attend de la personne : il part vide, prend le focus, et rien ne s'envoie avant
 * qu'il soit écrit.
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

/** Longueur maximale d'une consigne, telle que le serveur la borne (`lib/taskPayload.ts`). */
const DESCRIPTION_MAX = 4000;

/** Balises dont la fermeture termine une ligne à l'écran. */
const BLOCS = /<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi;

/**
 * Le retour tel qu'il s'écrit dans une consigne de tâche.
 *
 * Le corps d'un commentaire est du HTML ; une consigne est du texte simple, rendu en
 * `whitespace-pre-wrap`. Les frontières de blocs deviennent donc des sauts de ligne — sans
 * quoi deux paragraphes se colleraient en une phrase — et c'est le parseur du navigateur qui
 * relit le document plutôt qu'une expression régulière : lui seul rend « &amp; » à l'endroit
 * et ne laisse pas filer une balise en toutes lettres.
 *
 * Un retour peut faire dix mille signes là où la consigne s'arrête à quatre mille : le texte
 * est borné ici, au moment où il est encore lisible et modifiable, plutôt que refusé par
 * le serveur après l'envoi.
 */
export function noteAsBrief(html: string): string {
  const espace = html.replace(/<br\s*\/?>/gi, '\n').replace(BLOCS, '\n');
  const texte = new DOMParser().parseFromString(espace, 'text/html').body.textContent ?? '';
  return texte
    .replace(/[^\S\n]+/g, ' ') // espaces repliés, sauts de ligne préservés
    .replace(/ *\n\s*/g, '\n') // un seul saut par frontière de bloc, quelle que soit la mise en forme du HTML
    .trim()
    .slice(0, DESCRIPTION_MAX);
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
    // Le nom est ce qu'on vient chercher : il reste vide, et c'est lui qui prend le focus.
    setName('');
    // La consigne, elle, est déjà écrite — c'est le retour lui-même. Modifiable, comme le
    // reste : personne n'est obligé de garder la phrase telle qu'elle a été dictée.
    setDescription(noteAsBrief(comment.content));
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
            {/* Le champ dit lui-même qu'il est attendu — `required` et son invite — plutôt
                qu'un message d'erreur après un envoi qui, de toute façon, ne part pas. */}
            <input
              autoFocus
              required
              value={name}
              maxLength={160}
              placeholder={t('task.fromComment.namePlaceholder')}
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
              maxLength={DESCRIPTION_MAX}
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
