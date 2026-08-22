// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eye } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * Mode d'emploi d'un viewer spatial pour quelqu'un qui n'a jamais ouvert ReView : ce qu'il
 * voit est la mise en scène du studio, il peut tourner autour, et rien de ce qu'il fait
 * n'est enregistré. Une ligne de texte plutôt qu'une barre d'outils — l'invité n'a aucune
 * action à déclencher, seulement à comprendre.
 */
export default function ClientSpatialHint() {
  const t = useT();
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 text-foreground">
        <Eye size={11} /> {t('shares.permission.readOnly')}
      </span>
      <span>{t('tool.nav.hintSpatial')}</span>
      <span className="inline-flex items-center gap-1">
        <kbd className="rounded border border-border px-1 py-0.5 font-mono text-2xs">H</kbd>
        {t('action.resetSpatial')}
      </span>
      <span>{t('client.spatialFaithful')}</span>
    </p>
  );
}
