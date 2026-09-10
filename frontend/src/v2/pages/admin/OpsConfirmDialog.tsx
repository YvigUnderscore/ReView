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
 * Confirmation d'une opération d'exploitation, mot de passe à l'appui.
 *
 * Le mot de passe n'est pas une barrière contre une session volée — qui tient une session
 * d'administration sait aussi créer un compte. Il arrête le clic accidentel et l'onglet
 * resté ouvert derrière quelqu'un, ce qui est déjà l'essentiel du risque réel pour un
 * geste qui coupe le studio pendant plusieurs minutes. La vraie seconde barrière est
 * `deploy/agent.conf`, hors de portée de l'application.
 *
 * `ConfirmDialog` ne convient pas ici : il n'a pas de champ.
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
  /** Options propres à l'opération (case « sauvegarder d'abord », avertissements). */
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
