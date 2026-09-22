// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import WidgetShell, { type WidgetDragHandle } from '../../components/widgets/WidgetShell';
import WidgetResizeHandle, { WidgetRowsChoice } from '../../components/widgets/WidgetResizeHandle';
import { rowSpanClass, type WidgetSize } from '../../components/widgets/widgetSizing';
import {
  HOME_WIDGETS,
  type HomeResolvedSettings,
  type HomeWidgetId,
  type HomeWidgetSettings,
} from './homeWidgets';
import { useT } from '../../i18n';

/**
 * Cadre d'un bloc de l'accueil : le cadre commun (`components/widgets/WidgetShell`), à qui
 * ce fichier apporte ce que seul l'accueil sait — le titre du bloc, ses largeurs et ses
 * variantes, lus dans son registre.
 *
 * Le cadre lui-même est partagé avec la vue d'ensemble d'un projet : c'est le même en-tête,
 * la même poignée, le même menu et les mêmes réglages. Ce qui diffère d'une page à l'autre,
 * c'est la liste des blocs, pas la façon de les encadrer.
 *
 * Depuis le lot 13, c'est aussi ici que se monte le **redimensionnement** : le registre
 * donne les largeurs offertes et le titre dont la poignée s'annonce, si bien que la grille
 * n'a plus qu'à dire quelle taille est affichée et quoi faire de la nouvelle. La poignée
 * n'apparaît qu'en composition, avec celle du déplacement.
 */
export type { WidgetDragHandle };

export interface WidgetFrameProps {
  id: HomeWidgetId;
  /** Taille affichée comprise : pendant un glissement, c'est celle de l'aperçu. */
  settings: HomeResolvedSettings;
  editing: boolean;
  onSettings: (patch: HomeWidgetSettings) => void;
  onHide: () => void;
  onEdit: () => void;
  /** Déplacement d'une place, au clavier comme à la souris — le glisser n'est pas le seul chemin. */
  onMove: (direction: -1 | 1) => void;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  /** Taille sous le curseur pendant le glissement ; `null` quand il s'achève. */
  onPreview: (size: WidgetSize | null) => void;
  /** Taille retenue — la seule des deux qui s'enregistre. */
  onResize: (size: WidgetSize) => void;
  /** Fourni par le seul mode réagencement ; absent, le cadre ne connaît pas dnd-kit. */
  drag?: WidgetDragHandle;
  children: ReactNode;
}

export default function WidgetFrame({
  id,
  settings,
  onPreview,
  onResize,
  children,
  ...rest
}: WidgetFrameProps) {
  const t = useT();
  const definition = HOME_WIDGETS[id];
  const title = t(definition.labelKey);
  const size: WidgetSize = { span: settings.span, rows: settings.rows };

  return (
    <WidgetShell
      id={id}
      title={title}
      spans={definition.spans}
      variants={definition.variants}
      settings={settings}
      rowSizing={{
        className: rowSpanClass(size.rows),
        control: <WidgetRowsChoice rows={size.rows} onRows={(rows) => onResize({ ...size, rows })} />,
        // La poignée est une commande de composition : elle vit avec la poignée de
        // déplacement, et disparaît avec elle.
        handle: rest.editing ? (
          <WidgetResizeHandle
            name={title}
            size={size}
            spans={definition.spans}
            onPreview={onPreview}
            onCommit={onResize}
          />
        ) : null,
      }}
      {...rest}
    >
      {children}
    </WidgetShell>
  );
}
