// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { NumberField } from '../../../components/ui/number-field';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import { useT, type MessageKey } from '../../../i18n';
import { useColorGrade } from './useColorGrade';
import { useDisplayLut, useOcioDisplays } from './colorQueries';
import {
  EXPOSURE_RANGE,
  GAMMA_RANGE,
  isNeutral,
  resolveDisplayView,
  type ProjectColor,
} from './colorSettings';

/**
 * Panneau **Color** du dock : display, view, exposition, gamma, bascule et retour à zéro.
 *
 * Ce qu'il fait est une **préférence de lecture** — les pixels sont transformés à l'écran,
 * le média n'est jamais réécrit — et il l'écrit noir sur blanc, parce que c'est le contrat du
 * produit (un média publié est verrouillé) et que la confusion coûterait une version de plus.
 */
export default function ColorPanel({
  projectColor,
  /** La transformée n'est appliquée qu'à l'image fixe pour l'instant. */
  applies,
}: {
  projectColor: ProjectColor | null;
  applies: boolean;
}) {
  const t = useT();
  const { settings, supported, set, reset } = useColorGrade();
  const displaysQuery = useOcioDisplays(projectColor?.configId);
  const displays = displaysQuery.data ?? [];
  const target = resolveDisplayView(settings, projectColor, displays);
  const lutQuery = useDisplayLut(target, settings.enabled && applies);

  const currentDisplay = target?.display ?? '';
  const views = displays.find((d) => d.name === currentDisplay)?.views ?? [];

  const statusKey = ((): MessageKey => {
    // Une config supprimée laisse les projets qui la citaient avec un identifiant mort :
    // l'endpoint répond 404 et il n'y a plus rien à appliquer.
    if (!projectColor?.configId || displaysQuery.isError) return 'color.noConfig';
    if (!applies) return 'color.imageOnly';
    if (!supported) return 'color.unsupported';
    if (!settings.enabled) return 'color.transformOff';
    if (lutQuery.isPending && lutQuery.isFetching) return 'common.loading';
    if (lutQuery.data?.reason) return 'color.unavailable';
    if (lutQuery.data?.lut?.source === 'ocio') return 'color.source.ocio';
    if (lutQuery.data?.lut) return 'color.source.builtin';
    return 'color.noView';
  })();

  return (
    <Group title={t('viewer.color.title')}>
      <Row label={t('ocio.display')} stack hint={t('viewer.color.inherited')}>
        <Select
          className={DOCK_SELECT}
          aria-label={t('ocio.display')}
          value={currentDisplay}
          disabled={!displays.length}
          onChange={(e) => set({ display: e.target.value || null, view: null })}
        >
          <option value="">{t('color.projectDefault')}</option>
          {displays.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('ocio.view')} stack>
        <Select
          className={DOCK_SELECT}
          aria-label={t('ocio.view')}
          value={target?.view ?? ''}
          disabled={!views.length}
          onChange={(e) => set({ display: currentDisplay || null, view: e.target.value || null })}
        >
          <option value="">{t('color.projectDefault')}</option>
          {views.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('viewer.exposure')} hint={t('color.exposureHint')}>
        <NumberField
          label="EV"
          value={settings.exposure}
          onChange={(exposure) => set({ exposure })}
          min={EXPOSURE_RANGE.min}
          max={EXPOSURE_RANGE.max}
          step={EXPOSURE_RANGE.step}
          pixelsPerStep={6}
          hint={t('color.exposureHint')}
        />
      </Row>

      <Row label={t('color.gamma')} hint={t('color.gammaHint')}>
        <NumberField
          // Symbole technique, pas de la prose : c'est ainsi qu'on déclare « ne se traduit pas ».
          label={<kbd className="bg-transparent font-mono text-xs">γ</kbd>}
          value={settings.gamma}
          onChange={(gamma) => set({ gamma })}
          min={GAMMA_RANGE.min}
          max={GAMMA_RANGE.max}
          step={GAMMA_RANGE.step}
          pixelsPerStep={6}
          hint={t('color.gammaHint')}
        />
      </Row>

      <Row label={t('color.transform')} hint={t('color.transformHint')}>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          label={t('color.transform')}
        />
      </Row>

      <Row label={t('common.reset')}>
        <Button size="sm" variant="ghost" onClick={reset} disabled={isNeutral(settings)}>
          <RotateCcw size={13} />
          {t('common.reset')}
        </Button>
      </Row>

      <span className="rv-optbar__hint whitespace-normal">{t(statusKey)}</span>
      <span className="rv-optbar__hint whitespace-normal">{t('color.readingOnly')}</span>
    </Group>
  );
}
