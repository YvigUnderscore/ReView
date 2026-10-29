// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useT } from '../../i18n';

/**
 * Confirmation of an operations action, backed by a password.
 *
 * The password is not a barrier against a stolen session — whoever holds an administration session
 * can also create an account. It stops the accidental click and the tab
 * left open behind someone, which is already the bulk of the real risk for a
 * gesture that cuts the studio off for several minutes. The real second barrier is
 * `deploy/agent.conf`, out of the application's reach.
 *
 * `ConfirmDialog` does not fit here: it has no field.
 */
export default function OpsConfirmDialog({
  open,
  title,
  body,
  extra,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  /** Options specific to the operation (a "back up first" checkbox, warnings). */
  extra?: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: (password: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState('');

  const close = () => {
    setPassword('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) onConfirm(password);
          }}
        >
          {extra}
          <Field label={t('ops.update.password')}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!password || busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
