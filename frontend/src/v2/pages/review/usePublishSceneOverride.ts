import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import { isEmptyOverride, mergeOverrides, normalizeOverride } from './three/sceneOverride';

/**
 * Publier fige la scène (verrou Phase 11) : la mise en scène 3D **non enregistrée** du
 * gestionnaire devient d'abord l'override de base (46.S) — ce qu'il voit au moment de publier
 * est ce que les reviewers verront par défaut, sans passer par « Enregistrer pour tous ».
 *
 * Renvoie un rappel pour `useMediaActions` : `false` annule la publication — publier sans la
 * mise en scène voulue la perdrait définitivement, l'override étant figé ensuite.
 */
export function usePublishSceneOverride(
  id: number,
  data: MediaResp | null | undefined,
  ann: { sceneOverride: unknown; setSceneOverride: (value: unknown) => void },
): () => Promise<boolean> {
  const qc = useQueryClient();
  const { sceneOverride, setSceneOverride } = ann;

  return async () => {
    const pending = normalizeOverride(sceneOverride);
    if (data?.media.kind !== 'MODEL_3D' || isEmptyOverride(pending)) return true;
    try {
      const merged = mergeOverrides(normalizeOverride(data.usdOverride), pending);
      await api.put(`/api/media/${id}/usd/override`, { override: merged });
      // Cache ciblé, pas de refetch : les URLs présignées changeraient et rechargeraient le
      // viewer en pleine publication.
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, usdOverride: merged } : old));
      setSceneOverride(null);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Mise en scène non enregistrée — publication annulée');
      return false;
    }
  };
}
