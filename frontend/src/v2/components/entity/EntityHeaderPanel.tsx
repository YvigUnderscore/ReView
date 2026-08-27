// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText, Users } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import Avatar from '../Avatar';
import EntityNoteDialog from './EntityNoteDialog';
import type { ScopePerson } from './EntityTeamList';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import { useEntityNote, type NoteKind } from '../../lib/notesApi';
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
 * Ici, une ligne et rien de plus : les visages, et le fait qu'un brief existe. Le reste
 * s'ouvre en fenêtre — un dépliant qui pousse le travail vers le bas de l'écran se referme
 * aussitôt ouvert, et une planche de références n'y tenait pas.
 */
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

  const { data: people = [] } = useQuery({
    queryKey: ['assignees', kind, id],
    queryFn: () =>
      api.get<{ assignees: ScopePerson[] }>(`/api/${kind}/${id}/assignees`).then((r) => r.assignees),
    enabled: id > 0,
  });
  const { data: note } = useEntityNote(kind, id);
  const hasNote = Boolean(note?.body.trim());

  // Rien à montrer et rien à écrire : le panneau ne coûte pas une ligne pour rien.
  if (people.length === 0 && !hasNote && !canManage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group mb-4 flex w-full flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left shadow-sm transition-colors hover:border-primary hover:bg-secondary/30"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Users size={15} className="text-primary" />
          {t('entity.header.title')}
        </span>

        {people.length > 0 && (
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

        {/* L'état du brief se lit à la pastille : écrit, il porte l'accent ; absent, il est
            annoncé en creux, pour que personne ne cherche une fiche qui n'existe pas. */}
        <span
          className={`ml-auto flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
            hasNote ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
          }`}
        >
          <FileText size={13} />
          {hasNote ? t('entity.header.hasNote') : t('entity.header.noNote')}
        </span>
        <ChevronRight
          size={16}
          className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>

      {open && (
        <EntityNoteDialog
          kind={kind}
          id={id}
          projectId={projectId}
          canManage={canManage}
          people={people}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
