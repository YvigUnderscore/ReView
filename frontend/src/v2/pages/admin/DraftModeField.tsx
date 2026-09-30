// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Switch } from '../../components/ui/switch';
import { Panel } from './AdminPrimitives';
import { isDraftModeOn } from '../../lib/draftMode';
import { useT } from '../../i18n';

/**
 * Le studio garde-t-il le parcours en deux temps ?
 *
 * Depuis la Phase 50, un média est publié dès son dépôt : c'est le geste que les studios
 * attendaient, et le brouillon devient une option — éteinte par défaut. L'allumer rend à
 * l'interface toute la mécanique de brouillon (pastille des brouillons en attente, filtre
 * « Mes brouillons », action « Publier »).
 *
 * Le réglage vit dans les défauts de projet, à côté de la consigne exigée : les deux
 * décident de ce qui se passe quand un média arrive.
 */
export default function DraftModeField({
  value,
  onChange,
}: {
  /** Valeur enregistrée ou saisie — la table `Setting` ne stocke que du texte. */
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const on = isDraftModeOn(value);

  return (
    <Panel title={t('settings.draftMode')}>
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="draft-mode">
          {t('settings.draftMode.label')}
          <span className="block text-xs text-muted-foreground">{t('settings.draftMode.hint')}</span>
        </label>
        <Switch
          id="draft-mode"
          checked={on}
          onCheckedChange={(next) => onChange(next ? 'true' : 'false')}
          label={t('settings.draftMode.label')}
        />
      </div>
    </Panel>
  );
}
