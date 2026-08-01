import { Switch } from '../../../components/ui/switch';
import { useGuides, type GuideKey } from '../../../stores/useGuides';
import { Group, Row } from '../chrome/DockGroup';

const GUIDES: { key: GuideKey; label: string; hint: string }[] = [
  { key: 'thirds', label: 'Tiers', hint: 'Règle des tiers' },
  { key: 'center', label: 'Croix centrale', hint: 'Croix centrale' },
  { key: 'actionSafe', label: 'Action safe (90 %)', hint: 'Zone d’action sûre' },
  { key: 'titleSafe', label: 'Title safe (80 %)', hint: 'Zone de titres sûre' },
];

/**
 * Panneau Repères du dock plat : les interrupteurs des guides de composition, dont l'overlay
 * (`CompositionGuides`) ne bouge pas. Ils restent aussi accessibles au clic droit dans le
 * viewer — le menu contextuel est un doublon d'accès assumé, pas un emplacement concurrent.
 */
export default function GuidesPanel() {
  const guides = useGuides((s) => s.guides);
  const toggle = useGuides((s) => s.toggle);
  return (
    <>
      <Group title="Composition">
        {GUIDES.map((g) => (
          <Row key={g.key} label={g.label} hint={g.hint}>
            <Switch checked={guides[g.key]} onCheckedChange={() => toggle(g.key)} label={g.hint} />
          </Row>
        ))}
      </Group>
      <span className="rv-optbar__hint whitespace-normal">
        Préférence locale, aussi accessible au clic droit dans le viewer.
      </span>
    </>
  );
}
