// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import InfoPanel, { type InfoRow } from '../panels/InfoPanel';
import TexturesGroup from '../panels/TexturesGroup';
import UsdSceneGroup from '../panels/UsdSceneGroup';
import type { MediaResp } from '../reviewTypes';
import type { ModelSource } from '../../../types/api';
import type { Model3DInspectState } from './useModel3DInspect';
import { intlLocale, useT, type MessageKey, type Tr } from '../../../i18n';

/**
 * Panneau Infos du viewer 3D : ce qui se mesure pendant le rendu, la fiche technique du
 * fichier (provenance de conversion comprise), la scène USD et l'inspecteur de textures.
 * Séparé de `Model3DPanels`, qui n'aiguille que les six onglets — la fiche est le seul
 * panneau à croiser trois sources (statistiques Three, `modelSource`, description USD).
 */

const fmt = (n: number) => Math.round(n).toLocaleString(intlLocale());

/** Libellé du convertisseur qui a produit le GLB affiché ; `assimp` se dit tel quel. */
const CONVERTER_KEY: Record<string, MessageKey> = {
  copy: 'model3d.converter.copy',
  gltf: 'model3d.converter.gltf',
  blender: 'model3d.converter.blender',
  usd: 'model3d.converter.usd',
};

/**
 * Convertisseur retenu, suivi du badge « natif » quand la chaîne USD complète a été
 * employée : c'est la différence entre des matériaux fidèles et une géométrie nue, et elle
 * explique la moitié des « pourquoi ça ne ressemble pas à mon rendu ».
 */
function converterValue(source: ModelSource, t: Tr): ReactNode {
  const key = CONVERTER_KEY[source.converter];
  return (
    <span className="flex items-center gap-1.5">
      {key ? t(key) : source.converter}
      {source.native && (
        <span
          title={t('model3d.native.hint')}
          className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-secondary-foreground"
        >
          {t('model3d.native')}
        </span>
      )}
    </span>
  );
}

export default function Model3DInfo({
  data,
  inspect,
  onRecompose,
}: {
  data: MediaResp;
  inspect: Model3DInspectState;
  /** Recomposition USD — gestionnaire, média non publié, source USD présente. */
  onRecompose?: () => void;
}) {
  const t = useT();
  const s = inspect.stats;
  const source = data.modelSource;

  const live: InfoRow[] = s
    ? [
        { label: t('model3d.meshes'), value: fmt(s.meshes) },
        { label: t('model3d.triangles'), value: fmt(s.triangles) },
        { label: t('model3d.vertices'), value: fmt(s.vertices) },
        { label: t('viewer.materials'), value: fmt(s.materials.length) },
      ]
    : [{ label: t('stats.measuring'), value: '—' }];

  const sheet: InfoRow[] = [{ label: t('review.file'), value: data.media.originalName }];
  if (source) {
    sheet.push(
      { label: t('model3d.sourceFormat'), value: source.sourceFormat },
      { label: t('model3d.converter'), value: converterValue(source, t) },
    );
  }
  sheet.push(
    { label: t('info.uvSets'), value: s?.uvSets.length ? s.uvSets.join(', ') : t('review.none') },
    {
      label: t('model3d.extensions'),
      value: inspect.extensions.length ? inspect.extensions.join(', ') : t('common.noneFem'),
    },
  );

  return (
    <InfoPanel
      live={live}
      sheet={sheet}
      extra={
        <>
          {source?.usd && <UsdSceneGroup usd={source.usd} />}
          {/* Un modèle sans texture est courant (sculpt, blocking) : pas de groupe vide. */}
          {s && s.textures.length > 0 && <TexturesGroup textures={s.textures} />}
        </>
      }
      action={
        onRecompose && (
          <Button size="sm" variant="outline" onClick={onRecompose}>
            <Layers size={13} />
            {t('usd.recomposeFrom')}
          </Button>
        )
      }
    />
  );
}
