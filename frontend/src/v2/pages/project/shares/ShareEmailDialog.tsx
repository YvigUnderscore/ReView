// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { useT, intlLocale } from '../../../i18n';
import { parseRecipients, type ScopedShareLink } from './shareScope';

/**
 * Same ceiling as `SHARE_MAIL_MAX_RECIPIENTS` on the server side. Duplicated on purpose: without
 * it, a list pasted from a spreadsheet would go to the API and come back as a 400 with no
 * explanation.
 */
const MAX_RECIPIENTS = 10;

/**
 * Sends the link by email (the studio's SMTP relay already exists).
 *
 * The link used to be merely copied to the clipboard: the supervisor pasted it into a discussion
 * thread, without its expiry date or its view limit, and the client discovered the expiry by
 * clicking. The email carries both, and recalls the scope.
 */
export default function ShareEmailDialog({
  link,
  onClose,
}: {
  link: ScopedShareLink | null;
  onClose: () => void;
}) {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const recipients = parseRecipients(raw);
  const tooMany = recipients.length > MAX_RECIPIENTS;
  const expiry = link?.expiresAt
    ? new Date(link.expiresAt).toLocaleDateString(intlLocale(), {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link) return;
    if (recipients.length === 0) {
      toast.error(t('shares.email.invalid'));
      return;
    }
    setBusy(true);
    try {
      const { sent } = await api.post<{ sent: number }>(`/api/share/${link.id}/email`, {
        recipients,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t('shares.email.sent', { count: sent }));
      setRaw('');
      setNote('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shares.email.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="share-email-recipients">{t('shares.email.recipients')}</Label>
            <Textarea
              id="share-email-recipients"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={3}
              placeholder={t('shares.email.recipients.placeholder')}
            />
            <p className={`mt-1 text-xs ${tooMany ? 'text-destructive' : 'text-muted-foreground'}`}>
              {tooMany
                ? t('shares.email.tooMany', { count: MAX_RECIPIENTS })
                : t('shares.email.count', { count: recipients.length })}
            </p>
          </div>
          <div>
            <Label htmlFor="share-email-note">{t('shares.email.note')}</Label>
            <Textarea
              id="share-email-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('shares.email.note.placeholder')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {expiry ? t('shares.email.willMentionExpiry', { date: expiry }) : t('shares.email.noExpiry')}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || recipients.length === 0 || tooMany}>
              {t('shares.email.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
