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
 * Largeur en dessous de laquelle la pastille se réduit à son compte.
 *
 * Le texte d'état se repliait sous le seuil « fenêtre étroite » de la coquille (1100 px),
 * et c'était un contresens : c'est précisément là que la rangée gagne le plus de place —
 * la recherche y tombe à une icône, soit 20 rem rendues au fil d'Ariane. Un portable, ou
 * un navigateur posé à côté d'un logiciel 3D, perdait donc la seule chose qu'on demandait
 * à l'encart de montrer. Le repli n'a de sens qu'à la largeur d'un téléphone, où le fil
 * d'Ariane n'a lui-même plus de quoi s'écrire ; au-dessus, c'est le texte BORNÉ (max-w +
 * troncature) qui garantit la règle du lot 13 — la pastille pousse, elle ne chasse pas.
 */
const TIGHT_ROW_QUERY = '(max-width: 560px)';

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

/** Même libellé pour une séquence — le compte de frames y remplace le pourcentage d'octets. */
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

/** Une ligne encore en vol : c'est la moyenne de celles-là que la pastille résume. */
const isInFlight = (s: UploadStatus | SequenceUploadStatus): boolean => s !== 'done' && s !== 'error';

/** Les deux files partagent ce que la pastille lit : un état et un avancement. */
type UploadRowItem = UploadItem | SequenceUploadItem;

/**
 * Rang de pipeline : l'ordre dans lequel une ligne s'approche de `done`. Les statuts de
 * séquence sont un sous-ensemble de ceux d'un fichier isolé (pas de `finalizing`).
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
 * Ce que la pastille annonce quand plusieurs lignes sont en vol : **la plus avancée**.
 *
 * Le choix n'est pas neutre. La file est bornée à trois transferts simultanés : sur un dépôt
 * de trente plans, l'état *majoritaire* reste « En attente » du début à la fin, et l'encart
 * se figerait sur la seule chose qui ne bouge pas. La ligne la plus avancée est au contraire
 * celle dont l'état changera le prochain — à égalité de phase, celle qui mène au pourcentage.
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
 * Ce qui reste visible sans déplier (lot 14) : **terminés sur total**, et **l'état en cours**
 * de la ligne la plus avancée — un compte seul ne disait pas si ça progressait, et une roue
 * qui tourne ne disait pas ce qu'elle attendait.
 *
 * Lit les deux files Zustand globales — un fichier isolé et une séquence d'images n'ont ni
 * la même granularité ni le même coût, mais l'artiste les suit au même endroit. L'item
 * passe automatiquement en « Transcodage… » après l'envoi d'une vidéo, jusqu'à READY.
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
  // La file s'est vidée : le panneau n'a plus rien à déplier. Ajusté pendant le rendu (même
  // motif que la coquille) — un effet laisserait un rendu de plus avec un panneau vide.
  if (total === 0 && open) setOpen(false);
  if (total === 0) return <SequenceGroupDialog />;

  const rows: UploadRowItem[] = [...sequences, ...uploads];
  const inFlight = rows.filter((r) => isInFlight(r.status));
  // `x` compte ce qui est RÉELLEMENT arrivé : une ligne en échec n'est pas terminée, elle
  // reste dans le dénominateur jusqu'à ce qu'on la retire — c'est ce qui la rend visible.
  const done = rows.filter((r) => r.status === 'done').length;
  // Moyenne des lignes en vol : la pastille doit avancer sans qu'on la déplie.
  const pct = inFlight.length
    ? Math.round(inFlight.reduce((sum, r) => sum + r.progress, 0) / inFlight.length)
    : 100;
  const current = currentLabel(inFlight, t);
  const label = t('uploads.title', { count: total });
  // Au repos l'encart n'est qu'une icône de barre ; actif, il se nomme par son état.
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
            // Actif, l'encart cesse d'être une icône de barre : il prend la surface encadrée
            // de l'aperçu de la cloche, et son texte quitte le gris d'attente.
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
