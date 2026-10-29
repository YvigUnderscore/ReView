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
 * The client's response: "this is good for me" or "needs revision".
 *
 * Two buttons, not a list: "Pending", "CBB" and "Retake" are pipeline states, not answers.
 * The two offered are the ones the studio itself marked as validation and retake, so its
 * vocabulary is used without imposing ours or exposing the rest of its list to the client.
 *
 * What the client posts is an **opinion, not a verdict**: it is recorded in the version
 * history, attributed to their name and to the link they arrived through, and the
 * supervisor decides. This is stated below the buttons so nobody believes they moved the
 * plan on their own.
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
    // The name makes the opinion usable on the studio side: without it, the history would
    // read "someone asked for a retake".
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
      // The home queue sorts on `decided`, so it must reflect the answer immediately.
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
            {/* The dot carries the colour the studio gave to the status: it is a data value,
                not styling. */}
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
            <Icon size={13} /> {status.name}
          </button>
        ))}
      </div>
      {already && <p className="mt-2 text-2xs text-muted-foreground">{already}</p>}
    </div>
  );
}
