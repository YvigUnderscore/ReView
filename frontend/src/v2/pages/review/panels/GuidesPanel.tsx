// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Switch } from '../../../components/ui/switch';
import { useGuides, type GuideKey } from '../../../stores/useGuides';
import { Group, Row } from '../chrome/DockGroup';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const guideRows = (t: Tr): { key: GuideKey; label: string; hint: string }[] => [
  { key: 'thirds', label: t('review.guides.thirds'), hint: t('review.thirds') },
  { key: 'center', label: t('review.guides.center'), hint: t('review.guides.center') },
  { key: 'actionSafe', label: 'Action safe (90 %)', hint: t('review.guides.actionSafe.hint') },
  { key: 'titleSafe', label: 'Title safe (80 %)', hint: t('review.guides.titleSafe.hint') },
];

/**
 * Panneau Repères du dock plat : les interrupteurs des guides de composition, dont l'overlay
 * (`CompositionGuides`) ne bouge pas. Ils restent aussi accessibles au clic droit dans le
 * viewer — le menu contextuel est un doublon d'accès assumé, pas un emplacement concurrent.
 */
export default function GuidesPanel() {
  const t = useT();
  const guides = useGuides((s) => s.guides);
  const toggle = useGuides((s) => s.toggle);
  return (
    <>
      <Group title={t('review.guides.group')}>
        {guideRows(t).map((g) => (
          <Row key={g.key} label={g.label} hint={g.hint}>
            <Switch checked={guides[g.key]} onCheckedChange={() => toggle(g.key)} label={g.hint} />
          </Row>
        ))}
      </Group>
      <span className="rv-optbar__hint whitespace-normal">{t('review.guides.localHint')}</span>
    </>
  );
}
