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
 * What the montage can do, on right click.
 *
 * Renaming, targeting a pipeline step and freezing a revision used to occupy a permanent toolbar
 * at the top of each sequence page. They are three production gestures, rare and deliberate: they
 * belong to the context menu, not to the playback path (simple UI).
 *
 * The hook returns the entries **and** the rename dialog: an input field cannot live in a menu
 * that closes on the first click.
 */

/** The montage targets "the most advanced step" by default — this is what `null` means. */
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
        // The targeted step decides which version of each shot goes into the cut: it is a
        // production choice, stated once and rarely revisited. A radio group rather than a list of
        // actions — that is what makes the current step appear *ticked*.
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
