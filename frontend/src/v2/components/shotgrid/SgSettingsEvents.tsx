// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Rss, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Row, SettingNumber, SettingSelect, SettingsCard, Toggle } from './SgSettingsPrimitives';
import type { SgConnection, SgSettings } from '../../types/shotgrid';
import { useRotateWebhookSecret, useWebhookSecret } from '../../lib/shotgridApi';
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
  /**
   * Le secret ne descend pas avec la connexion : il se demande, et seulement quand
   * quelqu'un le regarde. Tant que ce bouton n'a pas été pressé, la valeur n'a jamais
   * traversé le réseau ni atteint le cache du client.
   */
  const [shown, setShown] = useState(false);
  const secret = useWebhookSecret(connection.projectId, shown);
  const rotateSecret = useRotateWebhookSecret(connection.projectId);

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(t('shotgrid.settings.copied'));
  };

  const regenerate = () => {
    if (!window.confirm(t('shotgrid.settings.secretRotateConfirm'))) return;
    rotateSecret.mutate(undefined, {
      onSuccess: () => {
        setShown(true);
        toast.success(t('shotgrid.settings.secretRotated'));
      },
      onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
    });
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
          <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">{t('shotgrid.settings.webhookHint')}</p>

            <div className="space-y-1">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shotgrid.settings.webhookUrlLabel')}
              </p>
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
            </div>

            {/*
              Le secret de signature. Il était généré à la création de la connexion et
              n'était montré nulle part : ShotGrid signait donc avec une autre valeur, et
              **toutes** les livraisons repartaient en 404 sans que rien ne l'explique.
            */}
            <div className="space-y-1">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shotgrid.settings.webhookSecretLabel')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                  {shown ? (secret.data ?? t('shotgrid.settings.secretNone')) : '••••••••••••••••'}
                </code>
                <button
                  type="button"
                  onClick={() => setShown((v) => !v)}
                  className="rounded-md border border-border p-1.5 hover:bg-secondary/60"
                  aria-label={shown ? t('shotgrid.settings.hideSecret') : t('shotgrid.settings.showSecret')}
                >
                  {shown ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  disabled={!secret.data}
                  onClick={() => secret.data && void copy(secret.data)}
                  className="rounded-md border border-border p-1.5 hover:bg-secondary/60 disabled:opacity-40"
                  aria-label={t('shotgrid.settings.copySecret')}
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('shotgrid.settings.webhookSecretHint')}</p>
            </div>

            {!disabled && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button
                  type="button"
                  onClick={onRotate}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <KeyRound size={12} /> {t('shotgrid.settings.rotateToken')}
                </button>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={rotateSecret.isPending}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ShieldCheck size={12} /> {t('shotgrid.settings.rotateSecret')}
                </button>
              </div>
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
