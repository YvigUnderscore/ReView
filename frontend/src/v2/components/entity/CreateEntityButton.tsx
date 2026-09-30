// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import BatchGenerator, { type GeneratedItem } from '../BatchGenerator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useSgConnection } from '../../lib/shotgridApi';
import { useT } from '../../i18n';

/**
 * Créer une séquence ou un plan : un bouton, pas un formulaire posé en permanence.
 *
 * Le générateur de codes occupait le haut de chaque onglet, ouvert en toutes circonstances
 * — six champs et un aperçu, au-dessus de la liste qu'on venait consulter. Or on crée des
 * séquences une fois en début de projet, et on lit la liste tous les jours. Le formulaire
 * passe donc derrière un « + », comme les autres actions rares (UI simple).
 *
 * Quand ShotGrid mène le projet, le bouton ne feint pas : il ouvre directement le
 * formulaire du site, pré-rempli sur le bon projet. Afficher un formulaire local pour se
 * heurter ensuite au refus du serveur n'apprenait rien à personne.
 */
const SG_ENTITY: Record<'sequence' | 'shot', string> = { sequence: 'Sequence', shot: 'Shot' };

export default function CreateEntityButton({
  projectId,
  kind,
  defaults,
  sequences,
  onSubmit,
}: {
  projectId: number;
  kind: 'sequence' | 'shot';
  defaults: { prefix: string; step: number; padding: number };
  /** Fourni pour les plans : la séquence de destination. */
  sequences?: { id: number; code: string; name: string }[];
  onSubmit: (items: GeneratedItem[]) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data: connection } = useSgConnection(projectId);
  const locked = Boolean(connection?.active && connection.settings.lockLocalCreation);
  const label = kind === 'sequence' ? t('sequences.new') : t('shots.new');

  if (locked && connection) {
    const url = `${connection.site.baseUrl.replace(/\/$/, '')}/new/${SG_ENTITY[kind]}?project=${connection.sgProjectId}`;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={t('shotgrid.locked.body')}
        aria-label={label}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        <Plus size={16} />
        <ExternalLink size={12} />
      </a>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Plus size={16} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <BatchGenerator
            defaults={defaults}
            sequences={sequences}
            onSubmit={async (items) => {
              await onSubmit(items);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
