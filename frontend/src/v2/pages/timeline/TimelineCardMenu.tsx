// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { Camera, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import type { useTimelineData } from './useTimelineData';
import { useT } from '../../i18n';

/**
 * Ce que le montage sait faire, au clic droit.
 *
 * Renommer, viser une étape du pipe et figer une révision occupaient une barre d'outils
 * permanente en tête de chaque page de séquence. Ce sont trois gestes de production, rares
 * et réfléchis : ils appartiennent au menu contextuel, pas au chemin de lecture (UI simple).
 *
 * Le hook rend les entrées **et** le dialogue de renommage : un champ de saisie ne peut pas
 * vivre dans un menu qui se ferme au premier clic.
 */

/** Le montage vise « l'étape la plus avancée » par défaut — c'est ce que `null` signifie. */
const AUTO = 'auto';

export function useTimelineCardMenu(
  data: ReturnType<typeof useTimelineData>,
  canManage: boolean,
): { entries: MenuEntry[]; dialog: ReactNode } {
  const t = useT();
  const [renaming, setRenaming] = useState<string | null>(null);
  const { timeline, rename, setDepartment, snapshot } = data;

  if (!timeline) return { entries: [], dialog: null };

  const entries: MenuEntry[] = canManage
    ? [
        {
          id: 'rename',
          label: t('common.rename'),
          icon: <Pencil size={14} />,
          onSelect: () => setRenaming(timeline.name ?? ''),
        },
        // L'étape visée décide quelle version de chaque plan monte au cut : c'est un choix
        // de production, énoncé une fois et rarement repris. Un groupe radio plutôt qu'une
        // liste d'actions — c'est ce qui fait apparaître l'étape courante *cochée*.
        {
          kind: 'submenu' as const,
          id: 'department',
          label: t('timeline.departmentHint'),
          items: [
            {
              kind: 'radiogroup' as const,
              id: 'department-choice',
              value: timeline.department ?? AUTO,
              onValueChange: (value: string) => void setDepartment(value === AUTO ? null : value),
              items: [
                { id: 'dept-auto', value: AUTO, label: t('timeline.departmentAuto') },
                ...timeline.departments.map((d) => ({ id: `dept-${d.key}`, value: d.key, label: d.name })),
              ],
            },
          ],
        },
        separator('snapshot'),
        {
          id: 'snapshot',
          label: t('timeline.snapshot'),
          icon: <Camera size={14} />,
          onSelect: () => void snapshot(),
        },
      ]
    : [];

  const dialog =
    renaming === null ? null : (
      <Dialog open onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void rename(renaming.trim() || null);
              setRenaming(null);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('common.rename')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>{t('timeline.defaultName')}</Label>
              <Input
                autoFocus
                value={renaming}
                placeholder={t('timeline.defaultName')}
                aria-label={t('timeline.defaultName')}
                onChange={(e) => setRenaming(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm">
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );

  return { entries, dialog };
}
