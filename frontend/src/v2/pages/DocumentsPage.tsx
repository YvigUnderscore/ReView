// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, FileType2, Trash2, Save } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useProjectsQuery } from '../lib/queries';
import { useAuth } from '../stores/useAuth';
import Shell from '../components/Shell';
import Avatar from '../components/Avatar';
import RichTextEditor from '../components/RichTextEditor';
import ConfirmDialog from '../components/ConfirmDialog';
import CreateDocModal from './documents/CreateDocModal';
import { SCOPE_LABEL, type Doc } from './documents/docTypes';

export default function DocumentsPage() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role !== 'CLIENT';
  const qc = useQueryClient();
  const [filterProject, setFilterProject] = useState<string>(''); // '' = global
  const [selected, setSelected] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projects = useProjectsQuery().data ?? [];
  const docsKey = qk.documents(filterProject ? Number(filterProject) : null);
  const docsQ = useQuery({
    queryKey: docsKey,
    queryFn: () =>
      api
        .get<{ documents: Doc[] }>(`/api/documents${filterProject ? `?projectId=${filterProject}` : ''}`)
        .then((d) => d.documents),
  });
  const docs = docsQ.data ?? [];
  const loadError = docsQ.error?.message ?? null;
  const invalidateDocs = () => qc.invalidateQueries({ queryKey: ['documents'] });

  const openDoc = async (d: Doc) => {
    const { document } = await api.get<{ document: Doc }>(`/api/documents/${d.id}`);
    setSelected(document);
    setEditing(false);
    setDraftTitle(document.title);
    setDraftContent(document.content ?? '');
  };
  const saveEdit = async () => {
    if (!selected) return;
    try {
      const { document } = await api.patch<{ document: Doc }>(`/api/documents/${selected.id}`, {
        title: draftTitle,
        content: draftContent,
      });
      setSelected({ ...selected, ...document });
      setEditing(false);
      invalidateDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/documents/${deleting.id}`);
      if (selected?.id === deleting.id) setSelected(null);
      setDeleting(null);
      invalidateDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  };

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <div className="flex items-center gap-2">
          <select
            value={filterProject}
            onChange={(e) => {
              setFilterProject(e.target.value);
              setSelected(null);
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Documents globaux</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Plus size={15} /> Nouveau document
            </button>
          )}
        </div>
      </div>
      {(error ?? loadError) && <p className="mb-3 text-sm text-destructive">{error ?? loadError}</p>}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Liste */}
        <div className="space-y-1.5">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">Aucun document.</p>}
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => openDoc(d)}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selected?.id === d.id
                  ? 'border-primary bg-secondary/50'
                  : 'border-border hover:border-primary'
              }`}
            >
              {d.kind === 'PDF' ? (
                <FileType2 size={16} className="shrink-0 text-destructive" />
              ) : (
                <FileText size={16} className="shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.title}</div>
                <div className="text-[10px] text-muted-foreground">{SCOPE_LABEL[d.scope]}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Détail / éditeur */}
        <div className="rounded-lg border border-border bg-card p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Sélectionnez un document ou créez-en un.</p>
          ) : (
            <div>
              <div className="mb-3 flex items-start justify-between gap-3">
                {editing ? (
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-lg font-semibold"
                  />
                ) : (
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                )}
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2">
                    {selected.kind === 'RICH' &&
                      (editing ? (
                        <button
                          onClick={saveEdit}
                          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                        >
                          <Save size={13} /> Enregistrer
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditing(true)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary/60"
                        >
                          Modifier
                        </button>
                      ))}
                    <button
                      onClick={() => setDeleting(selected)}
                      className="rounded-md p-1 text-destructive hover:bg-secondary"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar
                  seed={selected.createdBy.id}
                  initials={selected.createdBy.initials ?? '?'}
                  avatarUrl={selected.createdBy.avatarUrl}
                  size={20}
                />
                {selected.createdBy.displayName ?? selected.createdBy.name} · maj{' '}
                {new Date(selected.updatedAt).toLocaleDateString()}
              </div>

              {selected.kind === 'PDF' ? (
                selected.fileUrl ? (
                  <iframe
                    title={selected.title}
                    src={selected.fileUrl}
                    className="h-[70vh] w-full rounded border border-border"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">PDF indisponible.</p>
                )
              ) : editing ? (
                <RichTextEditor
                  value={draftContent}
                  onChange={setDraftContent}
                  placeholder="Rédigez la documentation…"
                />
              ) : (
                <div
                  className="prose-doc max-w-none text-sm"
                  dangerouslySetInnerHTML={{
                    __html: selected.content ?? '<p class="text-muted-foreground">Document vide.</p>',
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateDocModal
          projects={projects}
          defaultProjectId={filterProject ? Number(filterProject) : null}
          onClose={() => setCreating(false)}
          onCreated={(doc) => {
            setCreating(false);
            invalidateDocs();
            openDoc(doc);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le document ?"
        message={<>« {deleting?.title} » sera définitivement supprimé.</>}
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Shell>
  );
}
