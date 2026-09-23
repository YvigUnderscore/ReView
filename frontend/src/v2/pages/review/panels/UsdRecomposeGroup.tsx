// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import type { UsdModelInfo, UsdPurpose, UsdVariantSelection } from '../../../types/api';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { DOCK_SELECT, Group, Row } from '../chrome/DockGroup';
import { initialSelection, purposeLabel, variantValue } from '../usdDisplay';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/**
 * Recomposition d'une scène USD (Phase 45, 45.F) : rejouer la conversion avec une autre
 * sélection de variantes ou un autre purpose. Le fichier d'origine n'est pas touché — le
 * serveur applique la sélection via une couche d'overlay USD, puis reconvertit.
 *
 * **Ce n'est plus une modale** (lot 13). C'était un `Dialog` centré, sans hauteur maximale ni
 * défilement : une scène de production expose des dizaines de jeux de variantes, la fiche
 * dépassait donc en haut et en bas de la fenêtre — la moitié des listes et le bouton
 * d'envoi étaient hors d'atteinte, ni à la molette ni au clavier. Et l'overlay de la modale
 * coupait le viewer : impossible de tourner autour de la scène pour voir ce qu'on recompose.
 *
 * Forme retenue : un **groupe du dock inspecteur**, dans l'onglet Scène, juste sous le
 * scenegraph. C'est la surface latérale que le dépôt tient déjà pour « ce avec quoi on
 * travaille en regardant le viewer » (le viewer garde tout son canvas, aucun piège de focus),
 * elle défile de bout en bout (`.rv-dock__scroll`), et elle met la recomposition au contact de
 * l'arbre dont elle change les variantes — un seul sujet, un seul endroit. Le popover du
 * viewer, l'autre surface du dépôt, ne convenait pas : il se referme au premier clic dans la
 * scène, c'est-à-dire au premier geste de navigation.
 *
 * La liste des variantes porte en plus son propre défilement : au-delà d'une dizaine de jeux,
 * le bouton « Recomposer » restait au fond d'un panneau interminable.
 *
 * Ce défilement ne défilait pourtant pas (lot 15) : la colonne est bornée en hauteur, et
 * `.rv-row` déclarait une hauteur minimale explicite sans refuser la compression. Les rangées
 * retombaient donc au pas de 1,75 rem — la moitié de ce que mesure un libellé empilé sur son
 * select — et leur contenu se peignait sur la rangée voisine, « modelingVariant » par-dessus la
 * liste déroulante. Le correctif vit dans `chrome.css` : il vaut pour toute rangée de dock
 * posée dans une colonne bornée, pas seulement pour cette fenêtre.
 */

const purposes = (t: Tr): { value: UsdPurpose; label: string; hint: string }[] => [
  { value: 'render', label: purposeLabel('render'), hint: t('usd.renderGeom') },
  { value: 'proxy', label: purposeLabel('proxy'), hint: t('usd.proxyGeom') },
  { value: 'guide', label: purposeLabel('guide'), hint: t('usd.guideGeom') },
];

export default function UsdRecomposeGroup({ mediaId, usd }: { mediaId: number; usd: UsdModelInfo }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState<UsdPurpose>(usd.selection.purpose);
  const [variants, setVariants] = useState<UsdVariantSelection>(() => initialSelection(usd));

  const choose = (prim: string, name: string, value: string) =>
    setVariants((v) => ({ ...v, [prim]: { ...(v[prim] ?? {}), [name]: value } }));

  const submit = () => {
    setBusy(true);
    api
      .post(`/api/media/${mediaId}/usd/recompose`, { variants, purpose })
      .then(() => {
        toast.success(t('review.usd.recomposeStarted'));
        void qc.invalidateQueries({ queryKey: qk.media(mediaId) });
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.recompose')))
      .finally(() => setBusy(false));
  };

  return (
    <Group title={t('review.usd.recompose')} collapsible count={usd.variantSets.length}>
      <p className="text-2xs text-muted-foreground">{t('usd.recomposeHint')}</p>

      <Row label={t('usd.purpose')} stack hint={purposes(t).find((p) => p.value === purpose)?.hint}>
        <Select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as UsdPurpose)}
          className={DOCK_SELECT}
        >
          {purposes(t).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Row>

      {usd.variantSets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('review.usd.noVariants')}</p>
      ) : (
        <div
          // Le bouton d'envoi doit rester atteignable quelle que soit la richesse de la scène :
          // c'est la liste qui défile, pas la fenêtre entière. Le défilement tient au refus de
          // compression des rangées (`.rv-row { flex-shrink: 0 }`) : sans lui, la colonne bornée
          // écrase ses rangées au lieu de leur donner un ascenseur.
          data-testid="usd-variant-scroll"
          className="custom-scrollbar flex max-h-56 flex-col gap-1 overflow-y-auto pr-1"
        >
          {usd.variantSets.map((set) => (
            <Row
              key={`${set.prim}-${set.name}`}
              // Un nom de jeu de variantes est un identifiant USD, parfois plus long que les
              // 280 px du dock : il se coupe, et le chemin du prim reste en infobulle.
              label={<span className="truncate">{set.name}</span>}
              hint={set.prim}
              stack
            >
              <Select
                value={variantValue(variants, set.prim, set.name, set.selected)}
                onChange={(e) => choose(set.prim, set.name, e.target.value)}
                className={DOCK_SELECT}
              >
                {set.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Row>
          ))}
        </div>
      )}

      <Button size="sm" variant="outline" className="w-full" onClick={submit} disabled={busy}>
        <Layers size={13} />
        {busy ? t('common.starting') : t('usd.recomposeFrom')}
      </Button>
    </Group>
  );
}
