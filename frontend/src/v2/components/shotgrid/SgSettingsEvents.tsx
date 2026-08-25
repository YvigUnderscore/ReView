// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Copy, KeyRound, RefreshCw, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { Row, SettingNumber, SettingSelect, SettingsCard, Toggle } from './SgSettingsPrimitives';
import type { SgConnection, SgSettings } from '../../types/shotgrid';
import { useT } from '../../i18n';

/**
 * Comment ReView apprend qu'une chose a changé sur le site, et comment il rattrape ce qu'il
 * a manqué.
 *
 * Les deux vont ensemble : un webhook perdu ou une coupure se rattrapent à la
 * réconciliation, et régler l'un sans voir l'autre laisse une intégration qui paraît
 * fonctionner jusqu'au jour où elle a manqué une journée entière.
 */
export default function SgSettingsEvents({
  connection,
  settings,
  disabled,
  busy,
  onPatch,
  onRotate,
}: {
  connection: SgConnection;
  settings: SgSettings;
  disabled: boolean;
  busy: boolean;
  onPatch: (patch: Partial<SgSettings>) => void;
  onRotate: () => void;
}) {
  const t = useT();
  const s = settings;

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(t('shotgrid.settings.copied'));
  };

  return (
    <>
      <SettingsCard
        icon={Rss}
        title={t('shotgrid.settings.eventsTitle')}
        hint={t('shotgrid.settings.eventModeHint')}
        busy={busy}
      >
        <Row label={t('shotgrid.settings.eventMode')}>
          <SettingSelect
            value={s.eventMode}
            disabled={disabled}
            onChange={(v) => onPatch({ eventMode: v as SgSettings['eventMode'] })}
          >
            <option value="webhook">{t('shotgrid.settings.modeWebhook')}</option>
            <option value="polling">{t('shotgrid.settings.modePolling')}</option>
            <option value="manual">{t('shotgrid.settings.modeManual')}</option>
          </SettingSelect>
        </Row>

        {s.eventMode === 'polling' && (
          <Row label={t('shotgrid.settings.pollInterval')} hint={t('shotgrid.settings.pollIntervalHint')}>
            <SettingNumber
              value={s.pollingIntervalSec}
              min={15}
              max={3600}
              disabled={disabled}
              onChange={(v) => onPatch({ pollingIntervalSec: Number(v) })}
            />
          </Row>
        )}

        {s.eventMode === 'webhook' && (
          <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">{t('shotgrid.settings.webhookHint')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                {connection.webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => void copy(connection.webhookUrl)}
                className="rounded-md border border-border p-1.5 hover:bg-secondary/60"
                aria-label={t('shotgrid.settings.copyUrl')}
              >
                <Copy size={14} />
              </button>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={onRotate}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <KeyRound size={12} /> {t('shotgrid.settings.rotateToken')}
              </button>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        icon={RefreshCw}
        title={t('shotgrid.settings.reconcileTitle')}
        hint={t('shotgrid.settings.reconcileHint')}
      >
        <Toggle
          checked={s.reconcile.enabled}
          disabled={disabled}
          onChange={(v) => onPatch({ reconcile: { ...s.reconcile, enabled: v } })}
          label={t('shotgrid.settings.reconcileEnabled')}
        />
        <Toggle
          checked={s.reconcile.onBoot}
          disabled={disabled}
          onChange={(v) => onPatch({ reconcile: { ...s.reconcile, onBoot: v } })}
          label={t('shotgrid.settings.reconcileOnBoot')}
          hint={t('shotgrid.settings.reconcileOnBootHint')}
        />
        <Row label={t('shotgrid.settings.reconcileHour')}>
          <SettingNumber
            value={s.reconcile.hour}
            min={0}
            max={23}
            width="w-20"
            disabled={disabled}
            onChange={(v) => onPatch({ reconcile: { ...s.reconcile, hour: Number(v) } })}
          />
        </Row>
        <Row label={t('shotgrid.settings.lookback')} hint={t('shotgrid.settings.lookbackHint')}>
          <SettingNumber
            value={s.reconcile.lookbackHours}
            min={1}
            max={720}
            disabled={disabled}
            onChange={(v) => onPatch({ reconcile: { ...s.reconcile, lookbackHours: Number(v) } })}
          />
        </Row>
      </SettingsCard>
    </>
  );
}
