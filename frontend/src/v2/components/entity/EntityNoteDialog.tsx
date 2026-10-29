// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import NoteDocument from '../note/NoteDocument';
import NoteEditor from '../note/NoteEditor';
import EntityTeamList, { type ScopePerson } from './EntityTeamList';
import { useEntityNote, useSaveNote, type NoteKind, type NoteScope } from '../../lib/notesApi';
import { useT } from '../../i18n';

/**
 * An entity's team and brief, in a large view.
 *
 * They used to live in a header dropdown: a thirty-line note pushed the work off screen, and a board of
 * references had no chance of fitting. The window provides room: the brief is read like a document, written
 * in the same frame, and the page below keeps its height.
 *
 * Editing **replaces** reading instead of opening beside it: two columns thirty characters wide serve neither
 * to write nor to read, and the preview is one button away in the editor.
 */
export default function EntityNoteDialog({
  kind,
  id,
  projectId,
  canManage,
  people,
  onClose,
}: {
  kind: NoteKind;
  id: number;
  projectId: number;
  canManage: boolean;
  people: ScopePerson[];
  onClose: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { data: note } = useEntityNote(kind, id);
  const save = useSaveNote(kind, id);

  const scope = kind.slice(0, -1) as NoteScope;
  const hasNote = Boolean(note?.body.trim());

  /**
   * A half-written note does not close on a click outside.
   *
   * Escape, a click outside and the close button all go through here: a single gate to keep. Without it,
   * cancelling the file picker with Escape was enough to discard the edit in progress. The gesture is the
   * same, the intent is not.
   */
  const leave = (): boolean => {
    if (editing && dirty && !window.confirm(t('note.discardConfirm'))) return false;
    setEditing(false);
    setDirty(false);
    return true;
  };

  const submit = (body: string) => {
    save.mutate(body, {
      onSuccess: () => {
        toast.success(t('note.saved'));
        // Saved: nothing left to lose, the gate reopens freely.
        setDirty(false);
        setEditing(false);
      },
      onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return;
        if (leave()) onClose();
      }}
    >
      <DialogContent className="flex h-[86vh] w-[min(96vw,64rem)] max-w-none flex-col p-4">
        <DialogHeader className="mb-2 flex-row items-center gap-3 space-y-0 pr-8">
          <DialogTitle>{t('entity.header.title')}</DialogTitle>
          {canManage && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <Pencil size={12} /> {hasNote ? t('common.edit') : t('entity.header.writeNote')}
            </button>
          )}
        </DialogHeader>

        {editing ? (
          <NoteEditor
            initial={note?.body ?? ''}
            kind={kind}
            id={id}
            projectId={projectId}
            scope={scope}
            busy={save.isPending}
            onSave={submit}
            onCancel={leave}
            onDirtyChange={setDirty}
          />
        ) : (
          <div className="flex min-h-0 flex-1 gap-5">
            <aside className="w-52 shrink-0 overflow-y-auto border-r border-border pr-3">
              <h3 className="mb-1.5 text-2xs section-label text-muted-foreground">
                {t('entity.header.people')}
              </h3>
              <EntityTeamList people={people} />
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto pr-1">
              <h3 className="mb-1.5 text-2xs section-label text-muted-foreground">
                {t('entity.header.note')}
              </h3>
              {hasNote ? (
                <NoteDocument source={note!.body} />
              ) : (
                <p className="text-sm text-muted-foreground">{t('entity.header.noNote')}</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
