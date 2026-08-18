// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, Check, EyeOff, GripVertical, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import EntityContextMenu from '../../components/ui/entity-menu';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import {
  HOME_WIDGETS,
  heightClass,
  spanClass,
  type HomeWidgetId,
  type HomeWidgetSettings,
  type ResolvedWidgetSettings,
  type WidgetDensity,
  type WidgetHeight,
  type WidgetSpan,
  type WidgetVariant,
} from './homeWidgets';
import { useT, type MessageKey } from '../../i18n';

/**
 * Cadre commun d'un bloc de l'accueil (C2).
 *
 * Chaque widget rendait lui-même son cadre et son titre, et l'enveloppe ne portait qu'un
 * menu contextuel : il n'existait aucun endroit où accrocher une poignée, un réglage ou un
 * en-tête. Le cadre vit donc ici, avec les réglages du bloc, et les widgets ne rendent
 * plus que leur contenu.
 */

const HEIGHT_LABEL: Record<WidgetHeight, MessageKey> = {
  short: 'home.widget.height.short',
  normal: 'home.widget.height.normal',
  tall: 'home.widget.height.tall',
};

const VARIANT_LABEL: Record<WidgetVariant, MessageKey> = {
  list: 'home.widget.variant.list',
  grid: 'home.widget.variant.grid',
  kpi: 'home.widget.variant.kpi',
};

const DENSITY_LABEL: Record<WidgetDensity, MessageKey> = {
  comfortable: 'display.density.comfortable',
  compact: 'display.density.compact',
};

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
  children: ReactNode;
}

export default function WidgetFrame({
  id,
  settings,
  editing,
  onSettings,
  onHide,
  onEdit,
  onMove,
  canMoveBefore,
  canMoveAfter,
  children,
}: WidgetFrameProps) {
  const t = useT();
  const definition = HOME_WIDGETS[id];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });

  const title = t(definition.labelKey);
  const entries: MenuEntry[] = [
    { id: `edit-${id}`, label: t('home.widget.edit'), icon: <Settings2 size={14} />, onSelect: onEdit },
    separator(`move-${id}`),
    {
      id: `before-${id}`,
      label: t('home.widget.moveBefore'),
      icon: <ArrowLeft size={14} />,
      disabled: !canMoveBefore,
      onSelect: () => onMove(-1),
    },
    {
      id: `after-${id}`,
      label: t('home.widget.moveAfter'),
      icon: <ArrowRight size={14} />,
      disabled: !canMoveAfter,
      onSelect: () => onMove(1),
    },
    separator(`hide-${id}`),
    {
      id: `hide-${id}`,
      label: t('home.widget.hide', { name: title }),
      icon: <EyeOff size={14} />,
      onSelect: onHide,
    },
  ];

  const choice = <T extends string | number>(
    current: T,
    values: readonly T[],
    label: (v: T) => string,
    apply: (v: T) => void,
  ) => (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <button
          key={String(value)}
          onClick={() => apply(value)}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            value === current
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === current && <Check size={11} />}
          {label(value)}
        </button>
      ))}
    </div>
  );

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`col-span-12 ${spanClass(settings.span)} ${isDragging ? 'z-10 opacity-60' : ''}`}
      data-widget={id}
    >
      <EntityContextMenu entries={entries} nested>
        <div
          className={`flex h-full flex-col ${
            settings.bare ? '' : 'rounded-lg border border-border bg-card p-4'
          } ${editing ? 'ring-1 ring-primary/40' : ''}`}
        >
          {(!settings.bare || editing) && (
            <header className="mb-3 flex items-center gap-2">
              {editing && (
                <button
                  {...attributes}
                  {...listeners}
                  title={t('home.widget.drag')}
                  aria-label={t('home.widget.drag')}
                  className="cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <GripVertical size={14} />
                </button>
              )}
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
              {editing && (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        title={t('home.widget.edit')}
                        aria-label={t('home.widget.edit')}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Settings2 size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-3 p-3">
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('home.widget.width')}</p>
                        {choice<WidgetSpan>(
                          settings.span,
                          definition.spans,
                          (v) => `${String(v)}/12`,
                          (v) => onSettings({ span: v }),
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('home.widget.height')}</p>
                        {choice<WidgetHeight>(
                          settings.height,
                          ['short', 'normal', 'tall'],
                          (v) => t(HEIGHT_LABEL[v]),
                          (v) => onSettings({ height: v }),
                        )}
                      </div>
                      {definition.variants.length > 1 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t('home.widget.variant')}
                          </p>
                          {choice<WidgetVariant>(
                            settings.variant,
                            definition.variants,
                            (v) => t(VARIANT_LABEL[v]),
                            (v) => onSettings({ variant: v }),
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('display.density')}</p>
                        {choice<WidgetDensity>(
                          settings.density,
                          ['comfortable', 'compact'],
                          (v) => t(DENSITY_LABEL[v]),
                          (v) => onSettings({ density: v }),
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={settings.bare}
                          onChange={(e) => onSettings({ bare: e.target.checked })}
                        />
                        {t('home.widget.bare')}
                      </label>
                    </PopoverContent>
                  </Popover>
                  <button
                    onClick={onHide}
                    title={t('home.widget.hide', { name: title })}
                    aria-label={t('home.widget.hide', { name: title })}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <EyeOff size={14} />
                  </button>
                </>
              )}
            </header>
          )}
          <div className={`min-h-0 flex-1 ${heightClass(settings.height)}`}>{children}</div>
        </div>
      </EntityContextMenu>
    </section>
  );
}
