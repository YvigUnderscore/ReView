import { Box, Video } from 'lucide-react';
import { SegmentedControl } from '../../../components/ui/segmented-control';

export type TrackId = 'camera' | 'clip';

/**
 * Sélecteur de piste du transport spatial : l'animation caméra de la mise en scène, ou les
 * clips portés par le fichier. Absent quand le média n'a qu'une des deux.
 */
export default function TrackSwitch({
  track,
  onTrack,
  hasClips,
}: {
  track: TrackId;
  onTrack: (track: TrackId) => void;
  hasClips: boolean;
}) {
  return (
    <>
      <SegmentedControl
        label="Piste d’animation"
        items={[
          {
            value: 'camera' as const,
            label: 'Caméra',
            icon: Video,
            hint: 'Animation caméra de la mise en scène',
          },
          {
            value: 'clip' as const,
            label: 'Modèle',
            icon: Box,
            hint: hasClips ? 'Clips d’animation du fichier' : 'Ce fichier ne porte aucune animation',
            disabled: !hasClips,
          },
        ]}
        value={track}
        onChange={onTrack}
      />
      <span className="rv-rule" />
    </>
  );
}
