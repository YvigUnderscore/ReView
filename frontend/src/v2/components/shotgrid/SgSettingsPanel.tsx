// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { useRotateWebhookToken, useUpdateSgConnection } from '../../lib/shotgridApi';
import type { SgConnection, SgSettings } from '../../types/shotgrid';
import SgDomainMatrix from './SgDomainMatrix';

/**
 * Réglages complets de l'échange : matrice des droits, verrou de création, mode de
 * réception des événements, rattrapage, médias, écritures et arbitrage des conflits.
 * Chaque modification part immédiatement — pas de bouton « enregistrer » à oublier.
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
  const [saving, setSaving] = useState(false);
  const s = connection.settings;

  const patch = async (p: Partial<SgSettings>) => {
    setSaving(true);
    try {
      await update.mutateAsync({ settings: p });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(t('shotgrid.settings.copied'));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <header className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{t('shotgrid.settings.matrixTitle')}</h3>
          {saving && <Loader2 className="animate-spin text-muted-foreground" size={13} />}
        </header>
        <p className="text-xs text-muted-foreground">{t('shotgrid.settings.matrixHint')}</p>
        <SgDomainMatrix settings={s} onChange={patch} disabled={!canManage} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.creationTitle')}</h3>
        <Toggle
          checked={s.lockLocalCreation}
          disabled={!canManage}
          onChange={(v) => patch({ lockLocalCreation: v })}
          label={t('shotgrid.settings.lockCreation')}
          hint={t('shotgrid.settings.lockCreationHint')}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.eventsTitle')}</h3>
        <Row label={t('shotgrid.settings.eventMode')} hint={t('shotgrid.settings.eventModeHint')}>
          <select
            value={s.eventMode}
            disabled={!canManage}
            onChange={(e) => patch({ eventMode: e.target.value as SgSettings['eventMode'] })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="webhook">{t('shotgrid.settings.modeWebhook')}</option>
            <option value="polling">{t('shotgrid.settings.modePolling')}</option>
            <option value="manual">{t('shotgrid.settings.modeManual')}</option>
          </select>
        </Row>

        {s.eventMode === 'polling' && (
          <Row label={t('shotgrid.settings.pollInterval')} hint={t('shotgrid.settings.pollIntervalHint')}>
            <input
              type="number"
              min={15}
              max={3600}
              value={s.pollingIntervalSec}
              disabled={!canManage}
              onChange={(e) => patch({ pollingIntervalSec: Number(e.target.value) })}
              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
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
                onClick={() => copy(connection.webhookUrl)}
                className="rounded-md border border-border p-1.5 hover:bg-secondary/60"
                aria-label={t('shotgrid.settings.copyUrl')}
              >
                <Copy size={14} />
              </button>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={async () => {
                  await rotate.mutateAsync();
                  toast.success(t('shotgrid.settings.tokenRotated'));
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <KeyRound size={12} /> {t('shotgrid.settings.rotateToken')}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.reconcileTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('shotgrid.settings.reconcileHint')}</p>
        <Toggle
          checked={s.reconcile.enabled}
          disabled={!canManage}
          onChange={(v) => patch({ reconcile: { ...s.reconcile, enabled: v } })}
          label={t('shotgrid.settings.reconcileEnabled')}
        />
        <Toggle
          checked={s.reconcile.onBoot}
          disabled={!canManage}
          onChange={(v) => patch({ reconcile: { ...s.reconcile, onBoot: v } })}
          label={t('shotgrid.settings.reconcileOnBoot')}
          hint={t('shotgrid.settings.reconcileOnBootHint')}
        />
        <Row label={t('shotgrid.settings.reconcileHour')}>
          <input
            type="number"
            min={0}
            max={23}
            value={s.reconcile.hour}
            disabled={!canManage}
            onChange={(e) => patch({ reconcile: { ...s.reconcile, hour: Number(e.target.value) } })}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </Row>
        <Row label={t('shotgrid.settings.lookback')} hint={t('shotgrid.settings.lookbackHint')}>
          <input
            type="number"
            min={1}
            max={720}
            value={s.reconcile.lookbackHours}
            disabled={!canManage}
            onChange={(e) => patch({ reconcile: { ...s.reconcile, lookbackHours: Number(e.target.value) } })}
            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </Row>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.mediaTitle')}</h3>
        <Toggle
          checked={s.media.autoImport}
          disabled={!canManage}
          onChange={(v) => patch({ media: { ...s.media, autoImport: v } })}
          label={t('shotgrid.settings.autoImport')}
          hint={t('shotgrid.settings.autoImportHint')}
        />
        <Row label={t('shotgrid.settings.mediaSource')} hint={t('shotgrid.settings.mediaSourceHint')}>
          <select
            value={s.media.source}
            disabled={!canManage}
            onChange={(e) =>
              patch({ media: { ...s.media, source: e.target.value as 'transcoded' | 'original' } })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="transcoded">{t('shotgrid.settings.sourceTranscoded')}</option>
            <option value="original">{t('shotgrid.settings.sourceOriginal')}</option>
          </select>
        </Row>
        <Row label={t('shotgrid.settings.maxSize')} hint={t('shotgrid.settings.maxSizeHint')}>
          <input
            type="number"
            min={0}
            value={s.media.maxSizeMo ?? ''}
            disabled={!canManage}
            placeholder={t('shotgrid.settings.noLimit')}
            onChange={(e) =>
              patch({ media: { ...s.media, maxSizeMo: e.target.value ? Number(e.target.value) : null } })
            }
            className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </Row>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.pushTitle')}</h3>
        <Row label={t('shotgrid.settings.publishMode')} hint={t('shotgrid.settings.publishModeHint')}>
          <select
            value={s.push.publishMode}
            disabled={!canManage}
            onChange={(e) =>
              patch({ push: { ...s.push, publishMode: e.target.value as 'link' | 'upload' | 'off' } })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="link">{t('shotgrid.settings.publishLink')}</option>
            <option value="upload">{t('shotgrid.settings.publishUpload')}</option>
            <option value="off">{t('shotgrid.settings.publishOff')}</option>
          </select>
        </Row>
        <Toggle
          checked={s.push.attributeToUser}
          disabled={!canManage}
          onChange={(v) => patch({ push: { ...s.push, attributeToUser: v } })}
          label={t('shotgrid.settings.attributeToUser')}
          hint={t('shotgrid.settings.attributeToUserHint')}
        />
        <Toggle
          checked={s.push.attachAnnotations}
          disabled={!canManage}
          onChange={(v) => patch({ push: { ...s.push, attachAnnotations: v } })}
          label={t('shotgrid.settings.attachAnnotations')}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('shotgrid.settings.conflictTitle')}</h3>
        <Row label={t('shotgrid.settings.conflictPolicy')} hint={t('shotgrid.settings.conflictHint')}>
          <select
            value={s.conflictPolicy}
            disabled={!canManage}
            onChange={(e) => patch({ conflictPolicy: e.target.value as SgSettings['conflictPolicy'] })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="sg_wins">{t('shotgrid.settings.sgWins')}</option>
            <option value="review_wins">{t('shotgrid.settings.reviewWins')}</option>
            <option value="manual">{t('shotgrid.settings.manualResolve')}</option>
          </select>
        </Row>
      </section>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
    </label>
  );
}
