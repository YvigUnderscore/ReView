// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, EyeOff, GripVertical, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import EntityContextMenu from '../ui/entity-menu';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import {
  heightClass,
  spanClass,
  type ResolvedWidgetSettings,
  type WidgetDensity,
  type WidgetHeight,
  type WidgetSettings,
  type WidgetSpan,
  type WidgetVariant,
} from '../../lib/widgetLayout';
import { useT, type MessageKey } from '../../i18n';

/**
 * Cadre commun d'un bloc composable — en-tête, poignée, réglages, menu contextuel.
 *
 * Il est né à l'Accueil (C2), où chaque widget rendait lui-même son cadre : il n'existait
 * alors aucun endroit où accrocher une poignée ou un réglage. La vue d'ensemble d'un projet
 * demande le même cadre ; il ne lit donc plus le registre de l'accueil mais reçoit ce qu'il
 * affiche — titre, largeurs et variantes proposées.
 *
 * Les libellés restent sous le préfixe `home.widget.*` : ce sont mot pour mot les mêmes
 * messages (« Masquer », « Largeur », « Déplacer avant »…), et une clé ne se renomme pas
 * pour faire joli — elle se renommerait dans quatorze catalogues, sans qu'un seul mot
 * change à l'écran.
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

/**
 * Ce que le mode réagencement fournit au cadre — et rien de plus.
 *
 * Le cadre appelait lui-même `useSortable`, ce qui plaçait @dnd-kit (16,8 ko gzip) dans le
 * premier chargement de tout le monde, pour un geste que l'immense majorité des sessions ne
 * fait jamais (F5). Le glisser-déposer vit dans `WidgetSortable`, chargé à l'entrée en
 * édition ; hors édition, `drag` vaut `undefined` et le rendu est identique à ce que
 * produisait `useSortable({ disabled: true })` : ni transform, ni transition.
 */
export interface WidgetDragHandle {
  ref: (node: HTMLElement | null) => void;
  style: CSSProperties;
  dragging: boolean;
  /** Attributs ARIA et écouteurs de la poignée, fournis tels quels par dnd-kit. */
  handleProps: ButtonHTMLAttributes<HTMLButtonElement>;
}

/**
 * Ce qu'apporte une page dont la grille est en **rangées** — la vue d'ensemble d'un projet
 * (lot 12), puis l'accueil (lot 13), qui demandait « les mêmes réglages ».
 *
 * Le cadre ne connaît ni la rampe de hauteurs, ni le geste qui la parcourt : il reçoit la
 * classe de grille à poser, le réglage à montrer dans le panneau à la place de l'échelle
 * historique, et la poignée à placer au coin. Absent, le cadre retombe sur la largeur seule
 * et l'échelle `short`/`normal`/`tall` : c'est le rendu d'avant les rangées, que plus aucune
 * page ne demande aujourd'hui.
 */
export interface WidgetRowSizing {
  /** Classe portant l'emprise verticale (`row-span-N`), écrite en toutes lettres. */
  className: string;
  /** Réglage de hauteur du panneau — remplace l'échelle historique. */
  control: ReactNode;
  /** Poignée de coin : rendue par la page, positionnée par le cadre. */
  handle: ReactNode;
}

export interface WidgetShellProps {
  /** Identifiant du bloc : sert à nommer les entrées de menu et le `data-widget`. */
  id: string;
  title: string;
  /** Largeurs proposées au réglage ; une seule = pas de choix. */
  spans: WidgetSpan[];
  variants: [WidgetVariant, ...WidgetVariant[]];
  settings: ResolvedWidgetSettings;
  editing: boolean;
  onSettings: (patch: WidgetSettings) => void;
  onHide: () => void;
  onEdit: () => void;
  /** Déplacement d'une place, au clavier comme à la souris — le glisser n'est pas le seul chemin. */
  onMove: (direction: -1 | 1) => void;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  /** Fourni par le seul mode réagencement ; absent, le cadre ne connaît pas dnd-kit. */
  drag?: WidgetDragHandle;
  /** Fourni par les seules pages dont la grille a des rangées. */
  rowSizing?: WidgetRowSizing;
  children: ReactNode;
}

export default function WidgetShell({
  id,
  title,
  spans,
  variants,
  settings,
  editing,
  onSettings,
  onHide,
  onEdit,
  onMove,
  canMoveBefore,
  canMoveAfter,
  drag,
  rowSizing,
  children,
}: WidgetShellProps) {
  const t = useT();

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
      ref={drag?.ref}
      style={drag?.style}
      // `grid grid-rows-1` n'est pas décoratif : entre ce cadre et la carte, le menu
      // contextuel pose son propre conteneur, sans hauteur. Le `h-full` de la carte s'y
      // résoudrait en « hauteur du contenu », et l'emprise réglée ne réserverait qu'un
      // vide sous elle. Une rangée unique en `1fr` fait descendre la hauteur jusqu'à la
      // carte ; la poignée, absolue, reste hors flux.
      className={`col-span-12 ${spanClass(settings.span)} ${
        rowSizing ? `relative grid grid-rows-1 ${rowSizing.className}` : ''
      } ${drag?.dragging ? 'z-10 opacity-60' : ''}`}
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
                  {...drag?.handleProps}
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
                          spans,
                          (v) => `${String(v)}/12`,
                          (v) => onSettings({ span: v }),
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('home.widget.height')}</p>
                        {rowSizing
                          ? rowSizing.control
                          : choice<WidgetHeight>(
                              settings.height,
                              ['short', 'normal', 'tall'],
                              (v) => t(HEIGHT_LABEL[v]),
                              (v) => onSettings({ height: v }),
                            )}
                      </div>
                      {variants.length > 1 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t('home.widget.variant')}
                          </p>
                          {choice<WidgetVariant>(
                            settings.variant,
                            variants,
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
          {/* Grille en rangées : la carte a une hauteur imposée, donc c'est le contenu qui
              défile — jamais la carte qui grandit, sinon l'emprise réglée ne voudrait plus
              rien dire. */}
          <div className={`min-h-0 flex-1 ${rowSizing ? 'overflow-y-auto' : heightClass(settings.height)}`}>
            {children}
          </div>
        </div>
      </EntityContextMenu>
      {rowSizing?.handle}
    </section>
  );
}
