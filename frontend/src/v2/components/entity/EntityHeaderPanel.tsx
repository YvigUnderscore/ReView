// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import Avatar from '../Avatar';
import NoteView from '../note/NoteView';
import NoteEditor from '../note/NoteEditor';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import { useEntityNote, useSaveNote, type NoteKind, type NoteScope } from '../../lib/notesApi';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * L'en-tête d'une page de séquence, de plan ou d'asset : qui travaille là-dessus, et le
 * brief.
 *
 * Deux choses que ces pages ne disaient pas. **L'équipe** d'abord, et à l'échelle du
 * périmètre : sur une séquence, les gens sont sur ses plans et sur les tâches de ses plans,
 * pas sur la séquence elle-même — s'arrêter à l'entité aurait montré une liste vide dans le
 * cas courant. **Le brief** ensuite, qui n'avait nulle part où vivre : `description` vient
 * de ShotGrid et y retourne, souvent en lecture seule ici.
 *
 * Le panneau est replié par défaut. On ouvre une page de plan pour voir son travail, pas sa
 * fiche administrative ; l'en-tête annonce donc l'essentiel sur une ligne — les visages —
 * et se déplie quand on vient précisément pour ça.
 */

/** L'origine d'une personne dans le périmètre — sert à trier, et à l'expliquer au survol. */
type Origin = 'direct' | 'child' | 'task';
interface ScopePerson extends AssigneeRef {
  origins: Origin[];
  count: number;
}

const ORIGIN_LABEL: Record<
  Origin,
  'assignees.origin.direct' | 'assignees.origin.child' | 'assignees.origin.task'
> = {
  direct: 'assignees.origin.direct',
  child: 'assignees.origin.child',
  task: 'assignees.origin.task',
};

export default function EntityHeaderPanel({
  kind,
  id,
  projectId,
  canManage,
}: {
  kind: NoteKind;
  id: number;
  projectId: number;
  canManage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const { data: people = [] } = useQuery({
    queryKey: ['assignees', kind, id],
    queryFn: () =>
      api.get<{ assignees: ScopePerson[] }>(`/api/${kind}/${id}/assignees`).then((r) => r.assignees),
    enabled: id > 0,
  });
  const { data: note } = useEntityNote(kind, id);
  const save = useSaveNote(kind, id);

  const scope = kind.slice(0, -1) as NoteScope;
  const hasNote = Boolean(note?.body.trim());

  const submit = () => {
    if (editing === null) return;
    save.mutate(editing, {
      onSuccess: () => {
        toast.success(t('note.saved'));
        setEditing(null);
      },
      onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
    });
  };

  // Rien à montrer et rien à écrire : le panneau ne coûte pas une ligne pour rien.
  if (people.length === 0 && !hasNote && !canManage) return null;

  return (
    <section className="mb-4 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('entity.header.title')}
        </button>

        {/* Replié, l'en-tête montre déjà les visages : c'est ce qu'on vient y chercher. */}
        {!open && people.length > 0 && (
          <span className="flex items-center">
            {people.slice(0, 6).map((person, i) => (
              <span key={person.id} className={i > 0 ? '-ml-1.5' : ''}>
                <span className="block rounded-full ring-2 ring-card">
                  <Avatar
                    seed={person.id}
                    initials={initialsFrom(assigneeName(person))}
                    avatarUrl={person.avatarUrl}
                    size={22}
                  />
                </span>
              </span>
            ))}
            {people.length > 6 && (
              <span className="ml-1.5 text-2xs text-muted-foreground">+{people.length - 6}</span>
            )}
          </span>
        )}
        {!open && hasNote && (
          <span className="text-2xs text-muted-foreground">{t('entity.header.hasNote')}</span>
        )}
      </div>

      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          <div>
            <h3 className="mb-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              {t('entity.header.people')}
            </h3>
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('entity.header.noPeople')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {people.map((person) => (
                  <li
                    key={person.id}
                    title={person.origins.map((o) => t(ORIGIN_LABEL[o])).join(' · ')}
                    className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2.5"
                  >
                    <Avatar
                      seed={person.id}
                      initials={initialsFrom(assigneeName(person))}
                      avatarUrl={person.avatarUrl}
                      size={22}
                    />
                    <span className="text-xs">{assigneeName(person)}</span>
                    {person.origins.includes('direct') && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-2xs uppercase tracking-wide text-muted-foreground">
                {t('entity.header.note')}
              </h3>
              {canManage && editing === null && (
                <button
                  onClick={() => setEditing(note?.body ?? '')}
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            {editing !== null ? (
              <NoteEditor
                value={editing}
                onChange={setEditing}
                projectId={projectId}
                scope={scope}
                busy={save.isPending}
                onSave={submit}
                onCancel={() => setEditing(null)}
              />
            ) : hasNote ? (
              <NoteView source={note!.body} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('entity.header.noNote')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
