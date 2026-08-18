// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Search, X } from 'lucide-react';
import { Input } from './ui/input';
import { Select } from './ui/select';
import SavedViewsMenu from './SavedViewsMenu';
import {
  EMPTY_FILTERS,
  NONE,
  activeCount,
  fromRecord,
  toRecord,
  type EntityFilterState,
} from '../lib/entityFilters';
import type { UserRef } from '../types/api';
import { useT } from '../i18n';

/**
 * Barre de filtres partagée des listes de projet (C4) : kanban, Shots, Assets.
 *
 * Les deux dernières n'avaient ni filtre ni recherche — sur deux mille plans, il fallait
 * faire défiler. Et le kanban avait ses trois filtres à lui, avec un mécanisme de vues
 * sauvegardées séparé de celui du reste de l'application. Ici tout passe par
 * `useSavedViews`, donc les présélections nommées sont persistées côté serveur, par
 * compte et par portée.
 *
 * Chaque liste ne déclare que les critères qu'elle possède : un asset n'appartient pas
 * à une séquence, une liste de plans n'a pas d'assigné.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export default function EntityFilters({
  scope,
  value,
  onChange,
  statuses,
  assignees,
  sequences,
  departments,
  types,
  searchPlaceholder,
}: {
  /** Portée des vues sauvegardées, ex. `kanban:12` — par projet et par compte. */
  scope: string;
  value: EntityFilterState;
  onChange: (next: EntityFilterState) => void;
  statuses?: FilterOption[];
  assignees?: UserRef[];
  sequences?: FilterOption[];
  departments?: FilterOption[];
  types?: readonly string[];
  searchPlaceholder?: string;
}) {
  const t = useT();
  const set = (patch: Partial<EntityFilterState>) => onChange({ ...value, ...patch });
  const count = activeCount(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={value.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder={searchPlaceholder ?? t('filters.search')}
          className="h-9 w-48 pl-8"
        />
      </div>

      {statuses && statuses.length > 0 && (
        <Select value={value.status} onChange={(e) => set({ status: e.target.value })} className="py-1.5">
          <option value="">{t('filters.allStatuses')}</option>
          <option value={NONE}>{t('pipeline.status.none')}</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      )}

      {assignees && assignees.length > 0 && (
        <Select value={value.assignee} onChange={(e) => set({ assignee: e.target.value })} className="py-1.5">
          <option value="">{t('task.allAssignees')}</option>
          <option value={NONE}>{t('activity.unassigned')}</option>
          {assignees.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name ?? '—'}
            </option>
          ))}
        </Select>
      )}

      {sequences && sequences.length > 0 && (
        <Select value={value.sequence} onChange={(e) => set({ sequence: e.target.value })} className="py-1.5">
          <option value="">{t('task.allSequences')}</option>
          <option value={NONE}>{t('tree.outsideSequence')}</option>
          {sequences.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      )}

      {departments && departments.length > 0 && (
        <Select
          value={value.department}
          onChange={(e) => set({ department: e.target.value })}
          className="py-1.5"
        >
          <option value="">{t('filters.allDepartments')}</option>
          <option value={NONE}>{t('filters.noDepartment')}</option>
          {departments.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
      )}

      {types && types.length > 0 && (
        <Select value={value.type} onChange={(e) => set({ type: e.target.value })} className="py-1.5">
          <option value="">{t('task.allTypes')}</option>
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </Select>
      )}

      {count > 0 && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          title={t('filters.clear')}
          aria-label={t('filters.clear')}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X size={13} /> {count}
        </button>
      )}

      <SavedViewsMenu
        scope={scope}
        current={toRecord(value)}
        onApply={(record) => onChange(fromRecord(record))}
      />
    </div>
  );
}
