// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FileText, Film, GitMerge, Lock, Upload } from 'lucide-react';
import { Row, SettingNumber, SettingSelect, SettingsCard, Toggle } from './SgSettingsPrimitives';
import type { SgSettings } from '../../types/shotgrid';
import { useT } from '../../i18n';

/**
 * Ce qui circule entre les deux outils : médias importés, publications renvoyées,
 * descriptions, et qui gagne en cas de désaccord.
 *
 * La description a sa carte à elle, et ce n'est pas de la décoration : c'est le seul
 * réglage qui **rend un champ modifiable ou non** dans ReView. Le noyer dans « écritures »
 * aurait laissé les studios chercher pourquoi la description est grisée.
 */
export default function SgSettingsContent({
  settings,
  disabled,
  onPatch,
}: {
  settings: SgSettings;
  disabled: boolean;
  onPatch: (patch: Partial<SgSettings>) => void;
}) {
  const t = useT();
  const s = settings;

  return (
    <>
      <SettingsCard icon={Lock} title={t('shotgrid.settings.creationTitle')}>
        <Toggle
          checked={s.lockLocalCreation}
          disabled={disabled}
          onChange={(v) => onPatch({ lockLocalCreation: v })}
          label={t('shotgrid.settings.lockCreation')}
          hint={t('shotgrid.settings.lockCreationHint')}
        />
      </SettingsCard>

      <SettingsCard
        icon={FileText}
        title={t('shotgrid.settings.descriptionsTitle')}
        hint={t('shotgrid.settings.descriptionsHint')}
      >
        <Row label={t('shotgrid.settings.descriptionSource')}>
          <SettingSelect
            value={s.descriptions.source}
            disabled={disabled}
            onChange={(v) =>
              onPatch({ descriptions: { ...s.descriptions, source: v as 'shotgrid' | 'review' } })
            }
          >
            <option value="shotgrid">{t('shotgrid.settings.descriptionFromSg')}</option>
            <option value="review">{t('shotgrid.settings.descriptionFromReview')}</option>
          </SettingSelect>
        </Row>
        <Toggle
          checked={s.descriptions.writeBack}
          disabled={disabled}
          onChange={(v) => onPatch({ descriptions: { ...s.descriptions, writeBack: v } })}
          label={t('shotgrid.settings.descriptionWriteBack')}
          hint={t('shotgrid.settings.descriptionWriteBackHint')}
        />
      </SettingsCard>

      <SettingsCard icon={Film} title={t('shotgrid.settings.mediaTitle')}>
        <Toggle
          checked={s.media.autoImport}
          disabled={disabled}
          onChange={(v) => onPatch({ media: { ...s.media, autoImport: v } })}
          label={t('shotgrid.settings.autoImport')}
          hint={t('shotgrid.settings.autoImportHint')}
        />
        <Row label={t('shotgrid.settings.mediaSource')} hint={t('shotgrid.settings.mediaSourceHint')}>
          <SettingSelect
            value={s.media.source}
            disabled={disabled}
            onChange={(v) => onPatch({ media: { ...s.media, source: v as 'transcoded' | 'original' } })}
          >
            <option value="transcoded">{t('shotgrid.settings.sourceTranscoded')}</option>
            <option value="original">{t('shotgrid.settings.sourceOriginal')}</option>
          </SettingSelect>
        </Row>
        <Row label={t('shotgrid.settings.mediaNaming')} hint={t('shotgrid.settings.mediaNamingHint')}>
          <SettingSelect
            value={s.media.naming}
            disabled={disabled}
            onChange={(v) => onPatch({ media: { ...s.media, naming: v as 'sgCode' | 'filename' } })}
          >
            <option value="sgCode">{t('shotgrid.settings.namingSgCode')}</option>
            <option value="filename">{t('shotgrid.settings.namingFilename')}</option>
          </SettingSelect>
        </Row>
        <Row label={t('shotgrid.settings.maxSize')} hint={t('shotgrid.settings.maxSizeHint')}>
          <SettingNumber
            value={s.media.maxSizeMo}
            min={0}
            width="w-28"
            disabled={disabled}
            placeholder={t('shotgrid.settings.noLimit')}
            aria-label={t('shotgrid.settings.noLimit')}
            onChange={(v) => onPatch({ media: { ...s.media, maxSizeMo: v ? Number(v) : null } })}
          />
        </Row>
      </SettingsCard>

      <SettingsCard icon={Upload} title={t('shotgrid.settings.pushTitle')}>
        <Row label={t('shotgrid.settings.publishMode')} hint={t('shotgrid.settings.publishModeHint')}>
          <SettingSelect
            value={s.push.publishMode}
            disabled={disabled}
            onChange={(v) => onPatch({ push: { ...s.push, publishMode: v as 'link' | 'upload' | 'off' } })}
          >
            <option value="link">{t('shotgrid.settings.publishLink')}</option>
            <option value="upload">{t('shotgrid.settings.publishUpload')}</option>
            <option value="off">{t('shotgrid.settings.publishOff')}</option>
          </SettingSelect>
        </Row>
        <Toggle
          checked={s.push.attributeToUser}
          disabled={disabled}
          onChange={(v) => onPatch({ push: { ...s.push, attributeToUser: v } })}
          label={t('shotgrid.settings.attributeToUser')}
          hint={t('shotgrid.settings.attributeToUserHint')}
        />
        <Toggle
          checked={s.push.attachAnnotations}
          disabled={disabled}
          onChange={(v) => onPatch({ push: { ...s.push, attachAnnotations: v } })}
          label={t('shotgrid.settings.attachAnnotations')}
        />
      </SettingsCard>

      <SettingsCard
        icon={GitMerge}
        title={t('shotgrid.settings.conflictTitle')}
        hint={t('shotgrid.settings.conflictHint')}
      >
        <Row label={t('shotgrid.settings.conflictPolicy')}>
          <SettingSelect
            value={s.conflictPolicy}
            disabled={disabled}
            onChange={(v) => onPatch({ conflictPolicy: v as SgSettings['conflictPolicy'] })}
          >
            <option value="sg_wins">{t('shotgrid.settings.sgWins')}</option>
            <option value="review_wins">{t('shotgrid.settings.reviewWins')}</option>
            <option value="manual">{t('shotgrid.settings.manualResolve')}</option>
          </SettingSelect>
        </Row>
      </SettingsCard>
    </>
  );
}
