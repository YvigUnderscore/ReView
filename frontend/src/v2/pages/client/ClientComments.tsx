// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode, type RefObject } from 'react';
import { Clock, PenLine, Send } from 'lucide-react';
import type { ClientComment } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { formatTime, splitAnnotationParts } from '../review/reviewTypes';
import { frameOf } from './clientAnnotation';
import { useT } from '../../i18n';

/**
 * Fil de commentaires de la page client : notes rendues visibles au client par le studio,
 * horodatées quand elles portent sur une vidéo (clic = seek), et composeur pour les liens en
 * permission COMMENT. L'invité n'a pas de compte : son nom est saisi une fois et mémorisé
 * localement, rien de plus n'est demandé.
 */
export default function ClientComments({
  comments,
  canComment,
  timed,
  fps,
  startFrame,
  selectedId,
  onSelect,
  onSeek,
  onSubmit,
  composerRef,
  annotationBar,
  hasAnnotation,
  guestName,
  onGuestName,
  decision,
}: {
  comments: ClientComment[];
  canComment: boolean;
  /** Le média porte une notion de temps (vidéo) — affiche et rend cliquable l'horodatage. */
  timed: boolean;
  /** Cadence et première frame du projet : de quoi citer un NUMÉRO, pas une durée. */
  fps: number;
  startFrame: number;
  /** Note dont le dessin est affiché sur le viewer. */
  selectedId: number | null;
  /** Sélection d'une note : rejoue ensemble son dessin et sa position. */
  onSelect: (comment: ClientComment) => void;
  /** Position dans le **média** (hors slate) demandée par le clic sur un horodatage. */
  onSeek: (mediaSeconds: number) => void;
  onSubmit: (guestName: string, content: string) => Promise<void>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** Outils de dessin — posés SOUS le champ, là où la review interne met les siens. */
  annotationBar?: ReactNode;
  /** Un dessin en cours suffit à envoyer : le texte devient facultatif. */
  hasAnnotation: boolean;
  /** Le nom sous lequel l'invité s'exprime — partagé avec sa réponse, pas dupliqué ici. */
  guestName: string;
  onGuestName: (name: string) => void;
  /** Bloc « votre réponse », posé au-dessus du fil quand le lien autorise à se prononcer. */
  decision?: ReactNode;
}) {
  const t = useT();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Un dessin vaut un retour : on n'exige le texte que s'il n'y a rien d'autre à envoyer.
    if (!guestName.trim() || (!content.trim() && !hasAnnotation) || busy) return;
    setBusy(true);
    try {
      await onSubmit(guestName.trim(), content.trim());
      setContent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-full flex-col rounded-lg border border-border bg-card lg:w-80">
      {/* La réponse passe AVANT le fil : c'est ce qu'on attend du client, la note vient
          l'étayer. */}
      {decision}
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('admin.tab.comments')}</h2>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>}
        {comments.map((c) => {
          // Une note qui porte un dessin s'annonce : sans repère, le client ne sait pas
          // qu'un clic ferait apparaître un trait sur l'image.
          const hasDrawing = splitAnnotationParts(c.annotation).shapes.length > 0;
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(c);
              }}
              className={`cursor-pointer rounded-md p-2.5 text-sm transition-colors ${
                selectedId === c.id ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-secondary/40'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author?.name ?? c.guestName ?? t('comments.anonymous')}
                </span>
                {hasDrawing && <PenLine size={11} aria-label={t('comments.annotate')} />}
                {c.timestamp != null && timed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(c.timestamp!);
                    }}
                    className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                  >
                    {/* Un studio parle en frames. L'heure reste lisible pour qui scrube, le
                      numéro est ce que l'artiste retrouve dans son logiciel. */}
                    <Clock size={11} /> {formatTime(c.timestamp)} · {frameOf(c.timestamp, fps, startFrame)}
                  </button>
                )}
              </div>
              {/* Contenu déjà assaini côté serveur (sanitizeHtml) — affiché en texte brut. */}
              <p className="whitespace-pre-wrap break-words">{c.content.replace(/<[^>]+>/g, '')}</p>
            </div>
          );
        })}
      </div>
      {canComment && (
        <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
          <Input
            value={guestName}
            onChange={(e) => onGuestName(e.target.value)}
            placeholder={t('setup.adminName')}
            aria-label={t('setup.adminName')}
            maxLength={80}
            required
          />
          <Textarea
            ref={composerRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={timed ? t('client.commentAtFrame') : t('client.yourComment')}
            aria-label={timed ? t('client.commentAtFrame') : t('client.yourComment')}
            rows={3}
            maxLength={10000}
          />
          {annotationBar}
          <Button
            type="submit"
            size="sm"
            disabled={busy || (!content.trim() && !hasAnnotation)}
            className="w-full"
          >
            <Send size={13} className="mr-1" /> {t('common.send')}
          </Button>
        </form>
      )}
    </aside>
  );
}
