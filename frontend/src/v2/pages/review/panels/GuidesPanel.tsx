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
  { key: 'actionSafe', label: t('review.guides.actionSafe'), hint: t('review.guides.actionSafe.hint') },
  { key: 'titleSafe', label: t('review.guides.titleSafe'), hint: t('review.guides.titleSafe.hint') },
];

/** Repères de composition du dock vidéo — mêmes interrupteurs qu'au clic droit du viewer. */
export default function GuidesPanel() {
  const t = useT();
  const guides = useGuides((s) => s.guides);
  const toggle = useGuides((s) => s.toggle);
  return (
    <Group title={t('review.guides.group')}>
      {guideRows(t).map((g) => (
        <Row key={g.key} label={g.label} hint={g.hint}>
          <Switch checked={guides[g.key]} onCheckedChange={() => toggle(g.key)} label={g.hint} />
        </Row>
      ))}
    </Group>
  );
}
