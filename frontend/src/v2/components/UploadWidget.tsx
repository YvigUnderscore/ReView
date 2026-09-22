// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { CheckCircle2, Layers, Loader2, UploadCloud, X } from 'lucide-react';
import { useUploadStore, type UploadItem, type UploadStatus } from '../../stores/useUploadStore';
import {
  useSequenceUploadStore,
  type SequenceUploadItem,
  type SequenceUploadStatus,
} from '../../stores/useSequenceUploadStore';
import SequenceGroupDialog from './SequenceGroupDialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useIsNarrowViewport } from '../lib/useMediaQuery';
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

/** Une ligne encore en vol : c'est la moyenne de celles-là que la pastille résume. */
const isInFlight = (s: UploadStatus | SequenceUploadStatus): boolean => s !== 'done' && s !== 'error';

/**
 * Suivi des envois — **ancré dans la barre du haut, à gauche de la recherche**, comme la
 * cloche de notifications (lot 9).
 *
 * L'encart vivait en `fixed bottom-4 right-4`, et c'était son défaut : plusieurs centaines
 * de pixels de haut pendant l'envoi d'une séquence, posés par-dessus le coin bas droit de
 * l'écran — donc par-dessus la pagination d'une liste, le HUD d'un viewer, la conversation
 * ancrée à la sidebar, et les toasts qui atterrissaient au même endroit.
 *
 * Deux règles, celles de la cloche :
 *
 * 1. **Rien ne recouvre rien.** Ce qui reste visible pendant tout l'envoi — l'icône, le
 *    compte, l'avancement d'ensemble — vit DANS le flux de la rangée : il pousse, il ne se
 *    superpose pas. Le fil d'Ariane, à sa gauche, absorbe la place prise (`flex-1`).
 * 2. **Le détail se déplie.** La liste fichier par fichier est un panneau qui ne s'ouvre
 *    que sur un clic ; un envoi qui démarre ne l'ouvre jamais de lui-même.
 *
 * Lit les deux files Zustand globales — un fichier isolé et une séquence d'images n'ont ni
 * la même granularité ni le même coût, mais l'artiste les suit au même endroit. L'item
 * passe automatiquement en « Transcodage… » après l'envoi d'une vidéo, jusqu'à READY.
 */
export default function UploadWidget() {
  const t = useT();
  const narrow = useIsNarrowViewport();
  const [open, setOpen] = useState(false);
  const uploads = useUploadStore((s) => s.uploads);
  const clear = useUploadStore((s) => s.clearCompleted);
  const remove = useUploadStore((s) => s.removeUpload);
  const sequences = useSequenceUploadStore((s) => s.uploads);
  const clearSequences = useSequenceUploadStore((s) => s.clearCompleted);
  const removeSequence = useSequenceUploadStore((s) => s.removeUpload);
  const total = uploads.length + sequences.length;
  // La file s'est vidée : le panneau n'a plus rien à déplier. Ajusté pendant le rendu (même
  // motif que la coquille) — un effet laisserait un rendu de plus avec un panneau vide.
  if (total === 0 && open) setOpen(false);
  if (total === 0) return <SequenceGroupDialog />;

  const inFlight = [...sequences, ...uploads].filter((r) => isInFlight(r.status));
  // Moyenne des lignes en vol : la pastille doit avancer sans qu'on la déplie.
  const pct = inFlight.length
    ? Math.round(inFlight.reduce((sum, r) => sum + r.progress, 0) / inFlight.length)
    : 100;
  const label = t('uploads.title', { count: total });

  return (
    <>
      <SequenceGroupDialog />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={label}
            aria-label={label}
            className="flex shrink-0 items-center gap-1.5 rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {inFlight.length > 0 ? (
              <Loader2 size={18} className="animate-spin text-primary" />
            ) : (
              <UploadCloud size={18} />
            )}
            <span className="text-xs font-semibold tabular-nums">{total}</span>
            {/* Avancement d'ensemble. Masqué en fenêtre étroite, où la rangée n'a déjà plus
                de quoi montrer le fil d'Ariane — la cloche y replie son aperçu de même. */}
            {inFlight.length > 0 && !narrow && (
              <span className="h-1 w-8 overflow-hidden rounded bg-muted" aria-hidden>
                <span className="block h-full rounded bg-primary" style={{ width: `${pct}%` }} />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">{label}</span>
            <button
              type="button"
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
        </PopoverContent>
      </Popover>
    </>
  );
}
