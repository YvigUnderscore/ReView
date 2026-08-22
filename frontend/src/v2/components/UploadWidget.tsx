// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircle2, Layers, Loader2, X } from 'lucide-react';
import { useUploadStore, type UploadItem, type UploadStatus } from '../../stores/useUploadStore';
import {
  useSequenceUploadStore,
  type SequenceUploadItem,
  type SequenceUploadStatus,
} from '../../stores/useSequenceUploadStore';
import SequenceGroupDialog from './SequenceGroupDialog';
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

/**
 * Une séquence d'images en cours d'envoi.
 *
 * Le compte de fichiers est ce que l'artiste suit — « 342 / 1200 frames » situe mieux
 * qu'un pourcentage d'octets, les frames n'ayant pas toutes la même taille. La barre,
 * elle, reste en octets : c'est elle qui avance régulièrement.
 */
export function SequenceRow({
  item: s,
  onDismiss,
}: {
  item: SequenceUploadItem;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const cancellable: SequenceUploadStatus[] = ['pending', 'uploading'];
  return (
    <li className="text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <Layers size={11} className="shrink-0 text-primary" />
          {/* Motif FFmpeg : chaîne technique, jamais traduite. */}
          <code className="truncate">{s.pattern}</code>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {s.status === 'processing' && <Loader2 size={11} className="animate-spin text-primary" />}
          {s.status === 'done' && <CheckCircle2 size={11} className="text-success" />}
          {s.status === 'processing'
            ? t('imageSequence.assembling')
            : s.status === 'done'
              ? t('project.status.completed')
              : s.status === 'error'
                ? t('common.failed')
                : t('imageSequence.sending', { done: s.framesDone, total: s.totalFrames })}
          <button
            type="button"
            onClick={() => onDismiss(s.id)}
            aria-label={cancellable.includes(s.status) ? t('common.cancel') : t('common.remove')}
            className="rounded p-0.5 hover:bg-muted hover:text-foreground"
          >
            <X size={11} />
          </button>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
        {s.status === 'processing' ? (
          <div className="h-full w-1/3 animate-pulse rounded bg-primary/70" />
        ) : (
          <div
            className={`h-full ${s.status === 'error' ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${s.progress}%` }}
          />
        )}
      </div>
      {s.error && <p className="mt-1 text-destructive">{s.error}</p>}
    </li>
  );
}

/** Widget d'upload non-bloquant (bas-droite). Lit les deux files Zustand globales — un
 * fichier isolé et une séquence d'images n'ont ni la même granularité ni le même coût,
 * mais l'artiste les suit au même endroit. L'item passe automatiquement en
 * « Transcodage… » après l'envoi d'une vidéo, jusqu'à READY. */
export default function UploadWidget() {
  const t = useT();
  const uploads = useUploadStore((s) => s.uploads);
  const clear = useUploadStore((s) => s.clearCompleted);
  const remove = useUploadStore((s) => s.removeUpload);
  const sequences = useSequenceUploadStore((s) => s.uploads);
  const clearSequences = useSequenceUploadStore((s) => s.clearCompleted);
  const removeSequence = useSequenceUploadStore((s) => s.removeUpload);
  const total = uploads.length + sequences.length;
  if (total === 0) return <SequenceGroupDialog />;

  return (
    <>
      <SequenceGroupDialog />
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">{t('uploads.title', { count: total })}</span>
          <button
            onClick={() => {
              clear();
              clearSequences();
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('mode.clean')}
          </button>
        </div>
        <ul className="max-h-64 space-y-2 overflow-auto p-2">
          {sequences.map((s) => (
            <SequenceRow key={s.id} item={s} onDismiss={removeSequence} />
          ))}
          {uploads.map((u) => (
            <UploadRow key={u.id} item={u} onDismiss={remove} />
          ))}
        </ul>
      </div>
    </>
  );
}
