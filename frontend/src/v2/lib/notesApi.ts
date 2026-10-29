// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';

/**
 * Markdown record of an entity, and record templates.
 *
 * `description` comes from ShotGrid and goes back there: one line, often read-only in ReView. The
 * record is the opposite — it belongs to ReView, nobody overwrites it, and that is where the brief
 * lives. Two fields, two modules.
 */

/** URL segment of the owning entity. */
export type NoteKind = 'episodes' | 'sequences' | 'shots' | 'assets';
/** Scope of a template, in the singular — the one the server expects. */
export type NoteScope = 'all' | 'episode' | 'sequence' | 'shot' | 'asset';

export interface EntityNote {
  body: string;
  updatedAt: string | null;
  updatedBy: { id: number; name: string | null; username: string | null; avatarKey: string | null } | null;
}

export interface NoteTemplate {
  id: number;
  projectId: number | null;
  scope: NoteScope;
  name: string;
  body: string;
}

const noteKey = (kind: NoteKind, id: number) => ['note', kind, id] as const;
const templatesKey = (projectId: number | null, scope: NoteScope) =>
  ['note-templates', projectId, scope] as const;

export function useEntityNote(kind: NoteKind, id: number, enabled = true) {
  return useQuery({
    queryKey: noteKey(kind, id),
    queryFn: () => api.get<{ note: EntityNote }>(`/api/${kind}/${id}/note`).then((r) => r.note),
    enabled: enabled && id > 0,
  });
}

export function useSaveNote(kind: NoteKind, id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.put<{ note: EntityNote }>(`/api/${kind}/${id}/note`, { body }).then((r) => r.note),
    // The response is authoritative: it carries the author and the date the server has just written.
    onSuccess: (note) => qc.setQueryData(noteKey(kind, id), note),
  });
}

export function useNoteTemplates(projectId: number | null, scope: NoteScope) {
  return useQuery({
    queryKey: templatesKey(projectId, scope),
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', String(projectId));
      if (scope !== 'all') params.set('scope', scope);
      const query = params.toString();
      return api
        .get<{ templates: NoteTemplate[] }>(`/api/note-templates${query ? `?${query}` : ''}`)
        .then((r) => r.templates);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId?: number | null; scope: NoteScope; name: string; body: string }) =>
      api.post<{ template: NoteTemplate }>('/api/note-templates', input).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['note-templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/note-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['note-templates'] }),
  });
}
