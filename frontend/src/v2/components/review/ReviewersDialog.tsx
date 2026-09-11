// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import Avatar from '../Avatar';
import PeopleList from '../people/PeopleList';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import { useProjectMembers } from '../../lib/useProjectRole';
import { noteIssue, toNotePayload } from '../../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../../types/api';
import type { ReviewAssignee } from '../../types/entities';
import { useT } from '../../i18n';

/** Une ligne du dialogue : une personne, et la consigne qu'on lui écrit. */
interface Draft {
  userId: number;
  name: string;
  avatarUrl: string | null;
  note: string;
}

/**
 * Confier la review AU MOMENT DE PUBLIER.
 *
 * Le dialogue de décision (`ReviewAssignees`) est l'endroit du superviseur, après coup.
 * Celui-ci est l'endroit de l'uploader : il vient de livrer, il sait ce qu'il y a à
 * regarder, et c'est là que la consigne a le plus de valeur — c'est aussi le moment que le
 * réglage « consigne obligatoire à l'upload » vise.
 *
 * La liste se compose entièrement avant d'être envoyée, contrairement à l'écriture
 * immédiate de l'autre écran : ici rien n'est encore publié, et le bouton principal fait
 * les deux d'un coup. Un enregistrement par clic aurait posé des assignations sur une
 * version qu'on peut encore renoncer à publier.
 *
 * La consigne est **par personne** : « la lumière » au lead lighting et « le raccord au
 * 1042 » au monteur sont deux demandes différentes. Ajouter un second nom repart de la
 * consigne qu'on vient d'écrire, pour que « la même chose pour tous les trois » reste une
 * seule frappe.
 */
export default function ReviewersDialog({
  open,
  onOpenChange,
  projectId,
  reviewers,
  rule,
  submitLabel,
  title,
  description,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** L'état de départ — ce que la version porte déjà. */
  reviewers: ReviewAssignee[];
  rule: ReviewRequestRule;
  /** Libellé du bouton principal : c'est lui qui publie. */
  submitLabel: string;
  title: string;
  description: string;
  busy?: boolean;
  onSubmit: (reviewers: { userId: number; note: string | null }[]) => void | Promise<void>;
}) {
  const t = useT();
  const people = useProjectMembers(projectId);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    reviewers.map((person) => ({
      userId: person.id,
      name: assigneeName(person),
      avatarUrl: person.avatarUrl,
      note: person.note ?? '',
    })),
  );
  const [picking, setPicking] = useState(false);

  const add = (person: { id: number; name: string; avatarUrl?: string | null }) => {
    setDrafts((current) =>
      current.some((d) => d.userId === person.id)
        ? current
        : [
            ...current,
            {
              userId: person.id,
              name: person.name,
              avatarUrl: person.avatarUrl ?? null,
              // La consigne de la ligne précédente : le cas courant est « les trois mêmes
              // yeux sur la même chose », et retaper la phrase pousse à ne rien écrire.
              note: current[current.length - 1]?.note ?? '',
            },
          ],
    );
    setPicking(false);
  };

  const setNote = (userId: number, note: string) =>
    setDrafts((current) => current.map((d) => (d.userId === userId ? { ...d, note } : d)));

  const ready = drafts.every((d) => noteIssue(d.note, rule) === null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[22rem] space-y-3 overflow-y-auto">
          {drafts.length === 0 && !picking && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('reviewers.none')}
            </p>
          )}

          {drafts.map((draft) => {
            const issue = noteIssue(draft.note, rule);
            return (
              <div key={draft.userId} className="rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    seed={draft.userId}
                    initials={initialsFrom(draft.name)}
                    avatarUrl={draft.avatarUrl}
                    size={26}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{draft.name}</span>
                  <button
                    type="button"
                    onClick={() => setDrafts((c) => c.filter((d) => d.userId !== draft.userId))}
                    aria-label={t('reviewers.remove', { name: draft.name })}
                    title={t('reviewers.remove', { name: draft.name })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Textarea
                  autoGrow
                  minRows={2}
                  maxRows={6}
                  className="mt-2"
                  value={draft.note}
                  onChange={(e) => setNote(draft.userId, e.target.value)}
                  placeholder={t('reviewers.notePlaceholder')}
                  aria-label={t('reviewers.noteLabel', { name: draft.name })}
                  aria-invalid={issue !== null}
                />
                {/* Ce qui manque, dit avec le chiffre du projet — « trop courte » sans le
                    plancher oblige à deviner combien il en faut. */}
                {issue && (
                  <p className="mt-1 text-xs text-destructive">
                    {issue === 'missing'
                      ? t('reviewers.noteRequired')
                      : t('reviewers.noteTooShort', { min: rule.minNoteLength })}
                  </p>
                )}
              </div>
            );
          })}

          {picking ? (
            <PeopleList people={people} excludeIds={drafts.map((d) => d.userId)} onPick={add} />
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
              <UserPlus size={14} />
              {t('reviewers.add')}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!ready || busy}
            onClick={() =>
              void onSubmit(drafts.map((d) => ({ userId: d.userId, note: toNotePayload(d.note) })))
            }
          >
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
