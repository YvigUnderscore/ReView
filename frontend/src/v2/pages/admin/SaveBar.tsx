// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Save } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

/**
 * La barre d'enregistrement d'un écran de réglages : **une** par page, jamais une par champ.
 *
 * Elle ne s'arme que si quelque chose a changé, et le dit — c'est ce qui remplace les onze
 * boutons dispersés, dont aucun n'indiquait lequel restait à presser. « Annuler les
 * modifications » n'apparaît que lorsqu'il y a quelque chose à annuler.
 *
 * Collante en bas de la colonne : sur les écrans longs (rétention, défauts de projet) le
 * bouton restait hors de vue au moment précis où l'on venait de modifier quelque chose.
 */
export default function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        <Save size={14} /> {busy ? t('common.saving') : t('common.save')}
      </Button>
      {dirty && (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
            {t('settings.discardChanges')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('settings.unsavedChanges')}</span>
        </>
      )}
    </div>
  );
}
