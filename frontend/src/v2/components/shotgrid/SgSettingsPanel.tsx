// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { useRotateWebhookToken, useUpdateSgConnection } from '../../lib/shotgridApi';
import type { SgConnection, SgSettings } from '../../types/shotgrid';
import SgDomainMatrix from './SgDomainMatrix';
import SgSettingsEvents from './SgSettingsEvents';
import SgSettingsContent from './SgSettingsContent';
import { SettingsCard } from './SgSettingsPrimitives';

/**
 * Réglages de l'échange avec ShotGrid.
 *
 * Sept sections nues étaient empilées dans un seul flux : rien ne disait où finissait
 * « médias » et où commençait « écritures », et retrouver un réglage demandait de lire tous
 * les libellés. Elles sont désormais des cartes, chacune avec son intention, réparties en
 * **deux colonnes sur écran large** — la matrice des droits d'un côté, ce qui circule de
 * l'autre. Un écran de réglages se parcourt du regard, il ne se lit pas.
 *
 * Chaque modification part immédiatement : pas de bouton « enregistrer » à oublier.
 */
export default function SgSettingsPanel({
  connection,
  canManage,
}: {
  connection: SgConnection;
  canManage: boolean;
}) {
  const t = useT();
  const update = useUpdateSgConnection(connection.projectId);
  const rotate = useRotateWebhookToken(connection.projectId);
  const s = connection.settings;
  /**
   * L'état d'écriture vient de la mutation, pas d'un booléen local : le `finally` de ce
   * dernier retombait à `false` alors qu'une seconde requête était encore en vol. Il
   * verrouille tout le panneau, pas seulement la matrice — chaque contrôle reconstruit
   * l'objet complet à partir des réglages affichés, donc n'importe lequel peut écraser
   * l'écriture en cours s'il part d'un état périmé.
   */
  const saving = update.isPending;
  const disabled = !canManage || saving;

  const patch = (p: Partial<SgSettings>) => {
    update.mutate(
      { settings: p },
      {
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('common.error.generic')),
      },
    );
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <SettingsCard
          icon={ArrowLeftRight}
          title={t('shotgrid.settings.matrixTitle')}
          hint={t('shotgrid.settings.matrixHint')}
          busy={saving}
        >
          <SgDomainMatrix settings={s} onChange={patch} disabled={disabled} />
        </SettingsCard>

        <SgSettingsEvents
          connection={connection}
          settings={s}
          disabled={disabled}
          busy={saving}
          onPatch={patch}
          onRotate={() => {
            rotate.mutate(undefined, {
              onSuccess: () => toast.success(t('shotgrid.settings.tokenRotated')),
              onError: (err: unknown) =>
                toast.error(err instanceof Error ? err.message : t('common.error.generic')),
            });
          }}
        />
      </div>

      <div className="space-y-4">
        <SgSettingsContent settings={s} disabled={disabled} onPatch={patch} />
      </div>
    </div>
  );
}
