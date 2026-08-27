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
 * L'équipe et le brief d'une entité, en grand.
 *
 * Ils vivaient dans un dépliant de l'en-tête : une fiche de trente lignes y repoussait le
 * travail hors de l'écran, et une planche de références n'avait aucune chance d'y tenir.
 * La fenêtre donne la place — on lit le brief comme un document, on l'écrit dans le même
 * cadre, et la page en dessous garde sa hauteur.
 *
 * L'édition **remplace** la lecture au lieu de s'ouvrir à côté : deux colonnes de trente
 * caractères ne servent ni à écrire ni à lire, et l'aperçu est à un bouton dans l'éditeur.
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
   * Une fiche à moitié écrite ne se referme pas d'un clic à côté.
   *
   * Échap, le clic à l'extérieur et la croix passent tous par ici : une seule porte à
   * garder. Sans elle, annuler le sélecteur de fichiers avec Échap suffisait à emporter
   * l'édition en cours — le geste est le même, l'intention pas du tout.
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
        // Enregistré : plus rien à perdre, la porte se rouvre librement.
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
              <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
                {t('entity.header.people')}
              </h3>
              <EntityTeamList people={people} />
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto pr-1">
              <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
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
