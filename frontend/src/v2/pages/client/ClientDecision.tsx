// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { clientApi } from './clientApi';
import type { ClientMedia, ClientSharePayload } from '../../types/api';
import { useT } from '../../i18n';

/**
 * La réponse du client : « c'est bon pour moi » ou « à revoir ».
 *
 * Deux boutons, pas une liste : « Pending », « CBB » et « Retake » sont des états de
 * pipeline, pas des réponses. Les deux proposés sont ceux que le studio a lui-même marqués
 * comme validation et comme retake — son vocabulaire, sans qu'on lui impose le nôtre ni
 * qu'on expose au client le reste de sa liste.
 *
 * Ce que le client pose est un **avis, pas un verdict** : il s'inscrit dans l'historique de
 * la version, attribué à son nom et au lien par lequel il est arrivé, et le superviseur
 * tranche. C'est dit ici, sous les boutons, pour que personne ne croie avoir fait bouger le
 * plan tout seul.
 */
export default function ClientDecision({
  token,
  media,
  statuses,
  guestName,
}: {
  token: string;
  media: ClientMedia;
  statuses: NonNullable<ClientSharePayload['decisionStatuses']>;
  guestName: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);

  const offered = [
    { status: statuses.approval, icon: Check },
    { status: statuses.retake, icon: RotateCcw },
  ].filter((o): o is { status: NonNullable<typeof o.status>; icon: typeof Check } => o.status !== null);
  if (offered.length === 0) return null;

  const answer = async (statusId: number, name: string) => {
    // Le nom est ce qui rend l'avis utilisable côté studio : sans lui, l'historique dirait
    // « quelqu'un a demandé une retake ».
    if (!guestName.trim()) {
      toast.error(t('client.nameFirst'));
      return;
    }
    setBusy(true);
    try {
      await clientApi.post(token, `/media/${media.id}/decision`, {
        guestName: guestName.trim(),
        statusId,
      });
      setAnswered(name);
      toast.success(t('client.answerSent'));
      // La file d'accueil se range sur `decided` : elle doit refléter la réponse tout de suite.
      void qc.invalidateQueries({ queryKey: ['client-share', token] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const already = answered ?? (media.decided ? t('client.answered') : null);

  return (
    <div className="border-b border-border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t('client.yourAnswer')}</p>
      <div className="flex flex-wrap gap-2">
        {offered.map(({ status, icon: Icon }) => (
          <button
            key={status.id}
            type="button"
            disabled={busy}
            onClick={() => void answer(status.id, status.name)}
            title={status.name}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {/* La pastille porte la couleur que le studio a donnée au statut — c'est une
                valeur de données, pas de l'habillage. */}
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
            <Icon size={13} /> {status.name}
          </button>
        ))}
      </div>
      {already && <p className="mt-2 text-2xs text-muted-foreground">{already}</p>}
    </div>
  );
}
