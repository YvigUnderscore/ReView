// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { useT } from '../i18n';
import { formatBytes } from '../../lib/formatBytes';
import type { FileSequence } from '../../lib/imageSequence';
import { useSequenceUploadStore, type SequenceProposal } from '../../stores/useSequenceUploadStore';

/**
 * Proposition de regroupement d'un dépôt.
 *
 * Le regroupement n'est jamais imposé : ce dialogue est le seul endroit où il se décide.
 * Une séquence cochée deviendra UN média qui se review comme une vidéo ; décochée, ses
 * frames repartent en fichiers séparés — c'est encore un usage légitime (livrer trois
 * plaques de référence numérotées, par exemple).
 */

function SequenceRow({
  sequence,
  checked,
  onToggle,
}: {
  sequence: FileSequence;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const t = useT();
  return (
    <li className="flex items-start gap-3 rounded-md border border-border p-2">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(value) => onToggle(value === true)}
        aria-label={t('imageSequence.group')}
      />
      <div className="min-w-0 flex-1">
        {/* Le motif est une chaîne technique (FFmpeg) : il ne se traduit pas. */}
        <code className="block truncate text-sm text-foreground">{sequence.pattern}</code>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('imageSequence.frameRange', { from: sequence.startFrame, to: sequence.endFrame })} ·{' '}
          {t('imageSequence.files', { count: sequence.frameCount })} · {formatBytes(sequence.totalSize)}
        </p>
        {sequence.missingFrames > 0 && (
          <p className="mt-0.5 text-xs text-warning">
            {t('imageSequence.gaps', { count: sequence.missingFrames })}
          </p>
        )}
      </div>
    </li>
  );
}

function ProposalBody({ proposal }: { proposal: SequenceProposal }) {
  const t = useT();
  const accept = useSequenceUploadStore((s) => s.acceptProposal);
  const cancel = useSequenceUploadStore((s) => s.cancelProposal);
  // Tout est regroupé par défaut : c'est le cas de très loin le plus fréquent, et l'écart
  // se corrige d'un clic dans le sens le moins destructeur (dégrouper).
  const [kept, setKept] = useState<string[]>(() => proposal.sequences.map((s) => s.pattern));

  const toggle = (pattern: string, on: boolean): void =>
    setKept((prev) => (on ? [...prev, pattern] : prev.filter((p) => p !== pattern)));
  const chosen = proposal.sequences.filter((s) => kept.includes(s.pattern));

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Layers size={16} className="text-primary" />
          {t('imageSequence.detected')}
        </DialogTitle>
        <DialogDescription>{t('imageSequence.hint')}</DialogDescription>
      </DialogHeader>

      <ul className="max-h-72 space-y-2 overflow-auto">
        {proposal.sequences.map((sequence) => (
          <SequenceRow
            key={sequence.pattern}
            sequence={sequence}
            checked={kept.includes(sequence.pattern)}
            onToggle={(on) => toggle(sequence.pattern, on)}
          />
        ))}
      </ul>

      {proposal.singles.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('imageSequence.others', { count: proposal.singles.length })}
        </p>
      )}

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={cancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => accept([])}>
          {t('imageSequence.sendSeparately')}
        </Button>
        <Button size="sm" disabled={chosen.length === 0} onClick={() => accept(chosen)}>
          {t('imageSequence.confirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Monté une fois, avec le widget d'envoi : le dépôt peut venir de n'importe quelle page.
 * La clé sur le corps évite de garder la sélection d'un dépôt précédent — un effet de
 * remise à zéro aurait fait la même chose, en moins lisible.
 */
export default function SequenceGroupDialog() {
  const proposal = useSequenceUploadStore((s) => s.proposal);
  const cancel = useSequenceUploadStore((s) => s.cancelProposal);
  if (!proposal) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <ProposalBody key={proposal.sequences.map((s) => s.pattern).join('|')} proposal={proposal} />
    </Dialog>
  );
}
