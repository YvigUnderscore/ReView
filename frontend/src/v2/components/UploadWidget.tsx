// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useUploadStore, type UploadItem, type UploadStatus } from '../../stores/useUploadStore';
import { useT, type Tr } from '../i18n';

/** Libellé d'état lisible — le traitement serveur dépend du type de média. */
function statusLabel(u: UploadItem, t: Tr): string {
  switch (u.status) {
    case 'pending':
      return t('uploads.pending');
    case 'uploading':
      return t('uploads.sending', { pct: u.progress });
    case 'finalizing':
      return t('uploads.validating');
    case 'processing':
      return u.kind === 'VIDEO'
        ? t('uploads.transcoding')
        : u.kind === 'MODEL_3D'
          ? t('uploads.converting')
          : t('uploads.processing');
    case 'done':
      return t('project.status.completed');
    case 'error':
      return t('common.failed');
  }
}

/** Un transfert encore vivant s'annule ; une ligne terminée se retire simplement. */
const isCancellable = (s: UploadStatus): boolean =>
  s === 'pending' || s === 'uploading' || s === 'finalizing';

/** Une ligne de transfert : nom, état, barre, et la sortie qui manquait (annuler/retirer). */
export function UploadRow({ item: u, onDismiss }: { item: UploadItem; onDismiss: (id: string) => void }) {
  const t = useT();
  return (
    <li className="text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{u.filename}</span>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {(u.status === 'processing' || u.status === 'finalizing') && (
            <Loader2 size={11} className="animate-spin text-primary" />
          )}
          {u.status === 'done' && <CheckCircle2 size={11} className="text-success" />}
          {statusLabel(u, t)}
          <button
            type="button"
            onClick={() => onDismiss(u.id)}
            aria-label={isCancellable(u.status) ? t('common.cancel') : t('common.remove')}
            className="rounded p-0.5 hover:bg-muted hover:text-foreground"
          >
            <X size={11} />
          </button>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
        {u.status === 'processing' ? (
          // Traitement serveur : durée inconnue → barre indéterminée animée.
          <div className="h-full w-1/3 animate-pulse rounded bg-primary/70" />
        ) : (
          <div
            className={`h-full ${u.status === 'error' ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${u.progress}%` }}
          />
        )}
      </div>
      {u.error && <p className="mt-1 text-destructive">{u.error}</p>}
    </li>
  );
}

/** Widget d'upload non-bloquant (bas-droite). Lit le store Zustand global — l'item passe
 * automatiquement en « Transcodage… » après l'envoi d'une vidéo, jusqu'à READY. */
export default function UploadWidget() {
  const t = useT();
  const uploads = useUploadStore((s) => s.uploads);
  const clear = useUploadStore((s) => s.clearCompleted);
  const remove = useUploadStore((s) => s.removeUpload);
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{t('uploads.title', { count: uploads.length })}</span>
        <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
          {t('mode.clean')}
        </button>
      </div>
      <ul className="max-h-64 space-y-2 overflow-auto p-2">
        {uploads.map((u) => (
          <UploadRow key={u.id} item={u} onDismiss={remove} />
        ))}
      </ul>
    </div>
  );
}
