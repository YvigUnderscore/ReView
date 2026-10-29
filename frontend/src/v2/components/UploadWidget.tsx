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
import { useMediaQuery } from '../lib/useMediaQuery';
import { useT, type Tr } from '../i18n';

/**
 * Width below which the badge shrinks to its count.
 *
 * The status text used to fold below the shell's "narrow window" threshold (1100 px),
 * which was a misreading: that is precisely where the row gains the most room, since
 * search falls to an icon, that is 20 rem returned to the breadcrumb. A laptop, or
 * a browser placed next to 3D software, therefore lost the one thing the panel was asked
 * to show. The fallback only makes sense at phone width, where the breadcrumb itself no longer has room
 * to be written; above that, it is the BOUNDED text (max-w plus
 * truncation) that guarantees the batch 13 rule: the badge pushes, it does not crowd out.
 */
const TIGHT_ROW_QUERY = '(max-width: 560px)';

/** Readable status label: server-side processing depends on the media type. */
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

/** Same label for a sequence: the frame count replaces the byte percentage there. */
function sequenceStatusLabel(s: SequenceUploadItem, t: Tr): string {
  switch (s.status) {
    case 'processing':
      return t('imageSequence.assembling');
    case 'done':
      return t('project.status.completed');
    case 'error':
      return t('common.failed');
    default:
      return t('imageSequence.sending', { done: s.framesDone, total: s.totalFrames });
  }
}

/** A transfer still alive is cancelled; a finished line is simply removed. */
const isCancellable = (s: UploadStatus): boolean =>
  s === 'pending' || s === 'uploading' || s === 'finalizing';

/** A transfer line: name, status, bar, and the missing exit (cancel/remove). */
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
          // Server processing: unknown duration, so an animated indeterminate bar.
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
 * An image sequence being sent.
 *
 * The file count is what the artist follows: "342 / 1200 frames" places it better
 * than a byte percentage, since the frames are not all the same size. The bar,
 * for its part, stays in bytes: it is what advances steadily.
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
          {sequenceStatusLabel(s, t)}
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

/** A line still in flight: it is the average of those that the badge summarizes. */
const isInFlight = (s: UploadStatus | SequenceUploadStatus): boolean => s !== 'done' && s !== 'error';

/** Both queues share what the badge reads: a status and a progress. */
type UploadRowItem = UploadItem | SequenceUploadItem;

/**
 * Pipeline rank: the order in which a line approaches `done`. The statuses of
 * a sequence are a subset of those of an isolated file (no `finalizing`).
 */
const PHASE_RANK: Record<UploadStatus, number> = {
  pending: 0,
  uploading: 1,
  finalizing: 2,
  processing: 3,
  done: 4,
  error: 4,
};

/**
 * What the badge announces when several lines are in flight: **the most advanced one**.
 *
 * The choice is not neutral. The queue is bounded to three simultaneous transfers: on a drop
 * of thirty shots, the *majority* state would remain "Waiting" from start to finish, and the panel
 * would freeze on the one thing that never moves. The most advanced line, on the other hand,
 * is the one whose state will change next: at equal phase, the one leading to the percentage.
 */
function currentLabel(rows: UploadRowItem[], t: Tr): string | null {
  const lead = rows.reduce<UploadRowItem | null>((best, r) => {
    if (!best) return r;
    const gap = PHASE_RANK[r.status] - PHASE_RANK[best.status];
    return gap > 0 || (gap === 0 && r.progress > best.progress) ? r : best;
  }, null);
  if (!lead) return null;
  return 'pattern' in lead ? sequenceStatusLabel(lead, t) : statusLabel(lead, t);
}

/**
 * Send tracker: **anchored in the top bar, to the left of the search**, like the
 * notifications bell (batch 9).
 *
 * The panel used to live in `fixed bottom-4 right-4`, and that was its flaw: several hundred
 * pixels high during the send of a sequence, laid over the bottom right corner of
 * the screen, so over a list's pagination, a viewer's HUD, the conversation
 * anchored to the sidebar, and the toasts that landed in the same place.
 *
 * Two rules, those of the bell:
 *
 * 1. **Nothing covers anything.** What stays visible throughout the send (the icon, the
 *    count, the overall progress) lives INSIDE the flow of the row: it pushes, it does not
 *    overlap. The breadcrumb, on its left, absorbs the space taken (`flex-1`).
 * 2. **The detail unfolds.** The file-by-file list is a panel that opens only
 *    on a click; a send that starts never opens it by itself.
 *
 * What stays visible without unfolding (batch 14): **finished out of total**, and **the current state**
 * of the most advanced line. A count alone did not say whether things were progressing, and a spinning
 * wheel did not say what it was waiting for.
 *
 * Reads the two global Zustand queues: an isolated file and an image sequence have neither
 * the same granularity nor the same cost, but the artist follows them in the same place. The item
 * automatically switches to "Transcoding…" after the upload of a video, until READY.
 */
export default function UploadWidget() {
  const t = useT();
  const tight = useMediaQuery(TIGHT_ROW_QUERY);
  const [open, setOpen] = useState(false);
  const uploads = useUploadStore((s) => s.uploads);
  const clear = useUploadStore((s) => s.clearCompleted);
  const remove = useUploadStore((s) => s.removeUpload);
  const sequences = useSequenceUploadStore((s) => s.uploads);
  const clearSequences = useSequenceUploadStore((s) => s.clearCompleted);
  const removeSequence = useSequenceUploadStore((s) => s.removeUpload);
  const total = uploads.length + sequences.length;
  // The queue has emptied: the panel has nothing left to unfold. Adjusted during render (same
  // pattern as the shell), since an effect would leave one more render with an empty panel.
  if (total === 0 && open) setOpen(false);
  if (total === 0) return <SequenceGroupDialog />;

  const rows: UploadRowItem[] = [...sequences, ...uploads];
  const inFlight = rows.filter((r) => isInFlight(r.status));
  // `x` counts what has REALLY arrived: a failed line is not finished, it
  // stays in the denominator until it is removed, which is what makes it visible.
  const done = rows.filter((r) => r.status === 'done').length;
  // Average of the lines in flight: the badge must advance without unfolding it.
  const pct = inFlight.length
    ? Math.round(inFlight.reduce((sum, r) => sum + r.progress, 0) / inFlight.length)
    : 100;
  const current = currentLabel(inFlight, t);
  const label = t('uploads.title', { count: total });
  // At rest the panel is only a bar icon; when active, it is named by its state.
  const triggerLabel = current
    ? t('uploads.summaryBusyAria', { done, total, status: current })
    : t('uploads.summaryAria', { done, total });

  return (
    <>
      <SequenceGroupDialog />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={triggerLabel}
            aria-label={triggerLabel}
            // Active, the panel stops being a bar icon: it takes the framed surface
            // of the bell's preview, and its text leaves the waiting grey.
            className={`flex shrink-0 items-center gap-1.5 rounded-md transition-colors hover:bg-secondary/60 hover:text-foreground ${
              current
                ? 'border border-border bg-secondary/40 px-2 py-1.5 text-foreground'
                : 'p-2 text-muted-foreground'
            }`}
          >
            {current ? (
              <Loader2 size={18} className="shrink-0 animate-spin text-primary" />
            ) : (
              <UploadCloud size={18} className="shrink-0" />
            )}
            {/* x/y : terminés sur total. Le total seul ne disait pas si ça avançait. */}
            <span className="text-xs font-semibold tabular-nums">{t('uploads.ratio', { done, total })}</span>
            {/* L'état en cours et l'avancement d'ensemble : visibles dès qu'un envoi est en
                vol, jusqu'à la largeur d'un téléphone (cf. TIGHT_ROW_QUERY). Le texte est
                BORNÉ et tronqué — c'est lui qui cède, pas le fil d'Ariane ; le nom
                accessible du bouton, lui, porte toujours l'état en entier. */}
            {current && !tight && (
              <>
                <span className="max-w-[7rem] truncate text-xs lg:max-w-[12rem]">{current}</span>
                <span className="h-1 w-8 shrink-0 overflow-hidden rounded bg-muted" aria-hidden>
                  <span className="block h-full rounded bg-primary" style={{ width: `${pct}%` }} />
                </span>
              </>
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
