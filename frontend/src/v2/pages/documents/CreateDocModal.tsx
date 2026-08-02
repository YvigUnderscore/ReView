// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useSequencesQuery, useShotsQuery, useAssetsQuery } from '../../lib/queries';
import type { ProjectRef } from '../../types/api';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { SCOPE_LABEL, type Doc, type DocKind, type DocScope } from './docTypes';
import { useT } from '../../i18n';

interface EntityLite {
  id: number;
  code?: string;
  name: string;
}

/** Modal de création d'un document (texte riche ou PDF) avec rattachement fin. */
export default function CreateDocModal({
  projects,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: ProjectRef[];
  defaultProjectId: number | null;
  onClose: () => void;
  onCreated: (d: Doc) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DocKind>('RICH');
  const [scope, setScope] = useState<DocScope>(defaultProjectId ? 'PROJECT' : 'GLOBAL');
  const [projectId, setProjectId] = useState<string>(defaultProjectId ? String(defaultProjectId) : '');
  const [scopeId, setScopeId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Entités (séquences/shots/assets) du projet pour le rattachement fin
  const pid = projectId ? Number(projectId) : 0;
  const seqQ = useSequencesQuery(pid, !!projectId && scope === 'SEQUENCE');
  const shotsQ = useShotsQuery(pid, !!projectId && scope === 'SHOT');
  const assetsQ = useAssetsQuery(pid, !!projectId && scope === 'ASSET');
  const entities: EntityLite[] =
    scope === 'SEQUENCE'
      ? (seqQ.data?.sequences ?? [])
      : scope === 'SHOT'
        ? (shotsQ.data ?? [])
        : scope === 'ASSET'
          ? (assetsQ.data ?? [])
          : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title, kind, scope };
      if (scope !== 'GLOBAL') {
        if (!projectId) throw new Error(t('doc.chooseProject'));
        body.projectId = Number(projectId);
      }
      if (scope === 'SEQUENCE' || scope === 'SHOT' || scope === 'ASSET') {
        if (!scopeId) throw new Error(t('doc.chooseEntity'));
        body.scopeId = Number(scopeId);
      }
      if (kind === 'PDF') {
        if (!file) throw new Error(t('doc.selectPdf'));
        const { url, key } = await api.post<{ url: string; key: string }>('/api/documents/pdf/presign', {
          filename: file.name,
        });
        const put = await fetch(url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': 'application/pdf' },
        });
        if (!put.ok) throw new Error(t('doc.pdfUploadFailed'));
        body.fileKey = key;
      } else {
        body.content = '';
      }
      const { document } = await api.post<{ document: Doc }>('/api/documents', body);
      toast.success(t('documents.created'));
      onCreated(document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{t('doc.new')}</DialogTitle>
          </DialogHeader>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={t('editor.heading')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as DocKind)}
            >
              <option value="RICH">Texte riche</option>
              <option value="PDF">PDF</option>
            </select>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as DocScope);
                setScopeId('');
              }}
            >
              {(['GLOBAL', 'PROJECT', 'SEQUENCE', 'SHOT', 'ASSET'] as DocScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          {scope !== 'GLOBAL' && (
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setScopeId('');
              }}
              required
            >
              <option value="">Projet…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {(scope === 'SEQUENCE' || scope === 'SHOT' || scope === 'ASSET') && projectId && (
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              required
            >
              <option value="">{SCOPE_LABEL[scope]}…</option>
              {entities.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.code ? `${en.code} · ${en.name}` : en.name}
                </option>
              ))}
            </select>
          )}
          {kind === 'PDF' && (
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('common.undo')}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t('setup.submitting') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
