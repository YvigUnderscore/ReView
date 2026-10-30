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
 * "Create a task from this feedback": via naming (Phase 50).
 *
 * The name used to be imposed: the feedback text, truncated. This is the name that production
 * later reads on the kanban, in the pipe and, on a linked project, on the ShotGrid site,
 * where "the match cut jumps two frames, see Léa's head" no longer means anything.
 *
 * Offering it as a starting point fixed nothing (batch 13): the two fields were the
 * wrong way round. The feedback is not a title, it is the **instruction**: what is to be done, and it
 * must go there in full, not cut at eighty characters. The name, on the other hand, is precisely
 * what is expected from the person: it starts empty, takes the focus, and nothing is sent until
 * it is written.
 *
 * The dialog lives here rather than in the comment thread: the thread only opens
 * it, and creation (with its rights, step and status) is a task matter.
 */

/** What the thread knows about the feedback to convert. */
export interface CommentTaskSource {
  id: number;
  content: string;
}

/** Maximum length of an instruction, as the server bounds it (`lib/taskPayload.ts`). */
const DESCRIPTION_MAX = 4000;

/** Tags whose closing ends a line on screen. */
const BLOCS = /<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi;

/**
 * Feedback as it is written into a task instruction.
 *
 * A comment body is HTML; an instruction is plain text, rendered with
 * `whitespace-pre-wrap`. Block boundaries therefore become line breaks, otherwise two
 * paragraphs would stick together into one sentence. The browser's parser, not a regular
 * expression, reads the document: only it correctly decodes "&amp;" in place
 * and does not let a tag through spelled out.
 *
 * Feedback can run to ten thousand characters where the instruction stops at four thousand: the text
 * is bounded here, while it is still readable and editable, rather than rejected by
 * the server after sending.
 */
export function noteAsBrief(html: string): string {
  const espace = html.replace(/<br\s*\/?>/gi, '\n').replace(BLOCS, '\n');
  const texte = new DOMParser().parseFromString(espace, 'text/html').body.textContent ?? '';
  return texte
    .replace(/[^\S\n]+/g, ' ') // collapse runs of spaces, keep line breaks
    .replace(/ *\n\s*/g, '\n') // a single break per block boundary, whatever the HTML formatting
    .trim()
    .slice(0, DESCRIPTION_MAX);
}

export function useCommentTaskDialog(): {
  /** Opens the dialog for this feedback. */
  open: (comment: CommentTaskSource) => void;
  /** To be rendered once, in the calling screen. */
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
    // The name is what we came for: it stays empty, and it is what takes the focus.
    setName('');
    // The instruction, however, is already written: it is the feedback itself. Editable, like the
    // rest: nobody is obliged to keep the sentence as it was dictated.
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
      // The most expected error is a name already taken at this step: the dialog stays
      // open, with the name entered, so that changing it is enough.
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
            {/* The field says for itself that it is required (`required` and its prompt), rather
                than an error message after a submission that does not go through anyway. */}
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
