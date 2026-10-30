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
 * ShotGrid exchange settings.
 *
 * Seven bare sections were stacked in a single flow: nothing said where "media" ended and
 * "writes" began, and finding a setting meant reading every label. They are now cards,
 * each with its own purpose, laid out in **two columns on wide screens**: the rights
 * matrix on one side, what flows on the other. A settings screen is scanned, not read.
 *
 * Every change is applied immediately: there is no "save" button to forget.
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
   * The write state comes from the mutation, not from a local boolean: the `finally` of
   * the latter fell back to `false` while a second request was still in flight. It locks
   * the whole panel, not just the matrix: each control rebuilds the full object from the
   * displayed settings, so any of them could overwrite the write in progress if it starts
   * from a stale state.
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
