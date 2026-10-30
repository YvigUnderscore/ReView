// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { BookmarkPlus, FileText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useDeleteTemplate, useNoteTemplates, useSaveTemplate, type NoteScope } from '../../lib/notesApi';
import { useT } from '../../i18n';

/**
 * Note templates: finding them, and applying a new one.
 *
 * The brief of a shot has the same shape from one shot to the next: same sections, same gauges. Copying thirty lines
 * of markdown for each new shot amounted to not writing them.
 *
 * Applying a template **replaces** the note: merging two markdown structures would produce a result nobody wanted, and
 * undo exists (the editor's "Cancel" button has saved nothing as long as "Save" has not been clicked).
 */
export default function NoteTemplateMenu({
  projectId,
  scope,
  body,
  onApply,
}: {
  projectId: number;
  scope: NoteScope;
  /** The current note: it is what gets saved as a template. */
  body: string;
  onApply: (body: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const { data: templates = [] } = useNoteTemplates(projectId, scope);
  const save = useSaveTemplate();
  const remove = useDeleteTemplate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      { projectId, scope, name, body },
      {
        onSuccess: () => {
          toast.success(t('note.template.saved'));
          setName('');
          setSaving(false);
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('common.error.generic')),
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('note.template.menu')}
        aria-label={t('note.template.menu')}
        className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-2xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <FileText size={13} /> {t('note.template.menu')}
      </button>

      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('note.template.menu')}</DialogTitle>
            </DialogHeader>

            {templates.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t('note.template.empty')}</p>
            ) : (
              <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                {templates.map((template) => (
                  <li key={template.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onApply(template.body);
                        setOpen(false);
                      }}
                      className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
                    >
                      {template.name}
                      {template.projectId === null && (
                        <span className="ml-2 text-2xs text-muted-foreground">
                          {t('visibility.scope.studio')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(template.id)}
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      className="rounded p-1 text-destructive hover:bg-secondary"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {saving ? (
              <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
                <div className="space-y-1">
                  <Label>{t('note.template.name')}</Label>
                  <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSaving(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={save.isPending}>
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </form>
            ) : (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!body.trim()}
                  onClick={() => setSaving(true)}
                >
                  <BookmarkPlus size={14} /> {t('note.template.saveCurrent')}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
