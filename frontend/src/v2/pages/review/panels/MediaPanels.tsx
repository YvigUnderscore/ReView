import { Camera, FileDown, LayoutGrid, Scissors } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import type { MediaKind } from '../../../types/api';
import type { PanelId } from '../chrome/panels';
import { Group, Row } from '../chrome/DockGroup';
import GuidesPanel from './GuidesPanel';
import InfoPanel, { type InfoRow } from './InfoPanel';
import ExportPanel from './ExportPanel';
import type { MediaResp } from '../reviewTypes';
import type { CompareMode } from '../useCompareState';

const COMPARE_MODES = [
  { value: 'wipe' as const, label: 'Wipe' },
  { value: 'diff' as const, label: 'Diff.' },
  { value: 'side' as const, label: 'Côte à côte' },
];

/** Fiche technique du média, telle que l'API la renseigne. */
function sheetRows(data: MediaResp, kind: MediaKind, fps: number): InfoRow[] {
  const rows: InfoRow[] = [{ label: 'Fichier', value: data.media.originalName }];
  if (kind === 'VIDEO') {
    rows.push({ label: 'Cadence', value: `${fps} fps` });
    rows.push({ label: 'Première frame', value: String(data.startFrame) });
    if (data.hls) rows.push({ label: 'Diffusion', value: 'HLS adaptatif' });
    if (data.trim)
      rows.push({
        label: 'Découpe',
        value: `${data.trim.inFrame} → ${data.trim.outFrame}`,
      });
  }
  if (data.projectColor?.display) rows.push({ label: 'Display', value: data.projectColor.display });
  if (data.projectColor?.view) rows.push({ label: 'View', value: data.projectColor.view });
  rows.push({ label: 'Statut', value: data.media.status });
  return rows;
}

/**
 * Contenu du dock inspecteur pour les viewers plats. Les réglages de lecture et de
 * comparaison quittent les surcouches du lecteur pour six onglets fixes, communs à la vidéo
 * et à l'image.
 */
export default function MediaPanels({
  panel,
  kind,
  data,
  fps,
  compare,
  onExportFrame,
  onContactSheet,
}: {
  panel: PanelId | null;
  kind: MediaKind;
  data: MediaResp;
  fps: number;
  compare: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    /** Médias B choisis — la sélection elle-même vit dans l'en-tête de la review. */
    ids: number[];
    onClear: () => void;
  };
  onExportFrame?: () => void;
  onContactSheet?: () => void;
}) {
  if (panel === 'playback' || panel === 'view')
    return (
      <Group title={kind === 'VIDEO' ? 'Lecture' : 'Affichage'}>
        <Row label="Cadence" hint="Cadence de lecture — la timeline reste en frames">
          <span className="font-mono text-xs">{fps} fps</span>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">
          {kind === 'VIDEO'
            ? 'Lecture, son, boucle et qualité de flux se règlent dans la ligne de transport, sous l’image.'
            : 'Zoom, rotation et miroir se règlent dans la ligne de transport, sous l’image.'}
        </span>
      </Group>
    );

  if (panel === 'image')
    return (
      <Group title="Gestion de couleur">
        <Row label="Display">
          <Badge variant="secondary">{data.projectColor?.display ?? 'sRGB'}</Badge>
        </Row>
        <Row label="View">
          <Badge variant="secondary">{data.projectColor?.view ?? 'Aucune'}</Badge>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">
          Configuration OCIO du projet — le média n’est pas modifié.
        </span>
      </Group>
    );

  if (panel === 'guides') return <GuidesPanel />;

  if (panel === 'compare')
    return (
      <>
        <Group title="Versions">
          <Row label="A">
            <Badge variant="default">Courante</Badge>
          </Row>
          <Row label="B">
            {compare.ids.length ? (
              <Badge variant="secondary">
                {compare.ids.length} média{compare.ids.length > 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge variant="muted">aucun</Badge>
            )}
          </Row>
          <span className="rv-optbar__hint whitespace-normal">
            Le média comparé se choisit dans l’en-tête de la review.
          </span>
        </Group>
        {compare.ids.length > 0 && (
          <Group title="Mode">
            <SegmentedControl
              label="Mode de comparaison"
              items={COMPARE_MODES}
              value={compare.mode}
              onChange={compare.onMode}
            />
            <Row label="Comparaison active">
              <Switch checked onCheckedChange={() => compare.onClear()} label="Fermer la comparaison" />
            </Row>
          </Group>
        )}
      </>
    );

  if (panel === 'info') return <InfoPanel sheet={sheetRows(data, kind, fps)} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        staging={
          <>
            {onExportFrame && (
              <Button size="sm" variant="outline" onClick={onExportFrame}>
                <Camera size={13} />
                {kind === 'VIDEO' ? 'Frame courante (PNG)' : 'Vue affichée (PNG)'}
              </Button>
            )}
            {onContactSheet && (
              <Button size="sm" variant="ghost" onClick={onContactSheet}>
                <LayoutGrid size={13} />
                Planche contact
              </Button>
            )}
            {kind === 'VIDEO' && data.trim && (
              <span className="rv-optbar__hint whitespace-normal">
                <Scissors size={12} /> Un proxy trimé entrée → sortie est servi à tous.
              </span>
            )}
            {!onExportFrame && !onContactSheet && (
              <span className="rv-optbar__hint whitespace-normal">
                <FileDown size={12} /> Seul le fichier original est exportable ici.
              </span>
            )}
          </>
        }
      />
    );

  return null;
}
