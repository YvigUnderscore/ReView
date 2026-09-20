// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import WidgetShell, { type WidgetDragHandle } from '../../components/widgets/WidgetShell';
import { HOME_WIDGETS, type HomeWidgetId, type HomeWidgetSettings } from './homeWidgets';
import type { ResolvedWidgetSettings } from '../../lib/widgetLayout';
import { useT } from '../../i18n';

/**
 * Cadre d'un bloc de l'accueil : le cadre commun (`components/widgets/WidgetShell`), à qui
 * ce fichier apporte ce que seul l'accueil sait — le titre du bloc, ses largeurs et ses
 * variantes, lus dans son registre.
 *
 * Le cadre lui-même est partagé avec la vue d'ensemble d'un projet : c'est le même en-tête,
 * la même poignée, le même menu et les mêmes réglages. Ce qui diffère d'une page à l'autre,
 * c'est la liste des blocs, pas la façon de les encadrer.
 */
export type { WidgetDragHandle };

export interface WidgetFrameProps {
  id: HomeWidgetId;
  settings: ResolvedWidgetSettings;
  editing: boolean;
  onSettings: (patch: HomeWidgetSettings) => void;
  onHide: () => void;
  onEdit: () => void;
  /** Déplacement d'une place, au clavier comme à la souris — le glisser n'est pas le seul chemin. */
  onMove: (direction: -1 | 1) => void;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  /** Fourni par le seul mode réagencement ; absent, le cadre ne connaît pas dnd-kit. */
  drag?: WidgetDragHandle;
  children: ReactNode;
}

export default function WidgetFrame({ id, children, ...rest }: WidgetFrameProps) {
  const t = useT();
  const definition = HOME_WIDGETS[id];
  return (
    <WidgetShell
      id={id}
      title={t(definition.labelKey)}
      spans={definition.spans}
      variants={definition.variants}
      {...rest}
    >
      {children}
    </WidgetShell>
  );
}
