// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { usePlaylists } from '../../../lib/playlistApi';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import { Checkbox } from '../../../components/ui/checkbox';
import { useT } from '../../../i18n';
import { toggleMedia, versionsOf, type ScopeState, type ShareCandidate, type ShareScope } from './shareScope';

/**
 * Choix de ce qu'un lien ouvre. Sans lui, faire valider un plan par un client revenait à
 * lui ouvrir le projet entier : c'est le champ qui manquait au dialogue de création.
 */

/** Catalogue des médias publiés du projet — dérivé de la clé des liens, même invalidation. */
function useCandidates(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.shareLinks(projectId), 'candidates'],
    queryFn: () =>
      api
        .get<{ candidates: ShareCandidate[] }>(`/api/share/candidates?projectId=${projectId}`)
        .then((d) => d.candidates),
    enabled: enabled && projectId > 0,
  });
}

export default function ShareScopeFields({
  projectId,
  value,
  onChange,
}: {
  projectId: number;
  value: ScopeState;
  onChange: (next: ScopeState) => void;
}) {
  const t = useT();
  const needsCatalog = value.scope === 'VERSION' || value.scope === 'MEDIA';
  const playlistsQ = usePlaylists(value.scope === 'PLAYLIST' ? projectId : 0);
  const candidatesQ = useCandidates(projectId, needsCatalog);
  const candidates = candidatesQ.data ?? [];

  const setScope = (scope: ShareScope) =>
    onChange({ scope, playlistId: null, versionId: null, mediaIds: [] });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="share-scope">{t('shares.scope')}</Label>
        <Select id="share-scope" value={value.scope} onChange={(e) => setScope(e.target.value as ShareScope)}>
          <option value="PROJECT">{t('shares.scope.project')}</option>
          <option value="PLAYLIST">{t('shares.scope.playlist')}</option>
          <option value="VERSION">{t('shares.scope.version')}</option>
          <option value="MEDIA">{t('shares.scope.media')}</option>
        </Select>
      </div>

      {value.scope === 'PLAYLIST' && (
        <div>
          <Label htmlFor="share-playlist">{t('shares.scope.pick.playlist')}</Label>
          <Select
            id="share-playlist"
            value={value.playlistId ?? ''}
            onChange={(e) => onChange({ ...value, playlistId: Number(e.target.value) || null })}
          >
            <option value="">{t('shares.scope.pick.none')}</option>
            {(playlistsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {value.scope === 'VERSION' && (
        <div>
          <Label htmlFor="share-version">{t('shares.scope.pick.version')}</Label>
          <Select
            id="share-version"
            value={value.versionId ?? ''}
            onChange={(e) => onChange({ ...value, versionId: Number(e.target.value) || null })}
          >
            <option value="">{t('shares.scope.pick.none')}</option>
            {versionsOf(candidates).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {value.scope === 'MEDIA' && (
        <div>
          <Label htmlFor="share-media-list">{t('shares.scope.pick.media')}</Label>
          <div
            id="share-media-list"
            className="max-h-52 overflow-y-auto rounded-md border border-border bg-background/40 p-1"
          >
            {candidates.length === 0 && !candidatesQ.isLoading && (
              <p className="p-3 text-center text-xs text-muted-foreground">{t('shares.scope.empty')}</p>
            )}
            {candidates.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              >
                <Checkbox
                  checked={value.mediaIds.includes(c.id)}
                  onCheckedChange={() => onChange({ ...value, mediaIds: toggleMedia(value.mediaIds, c.id) })}
                />
                <span className="min-w-0 flex-1 truncate">{c.originalName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.location} · {c.versionName}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('shares.scope.selected', { count: value.mediaIds.length })}
          </p>
        </div>
      )}
    </div>
  );
}
