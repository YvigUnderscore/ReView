// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { useT, type MessageKey } from '../../i18n';

/**
 * Qui peut écrire sur une tâche.
 *
 * Un studio de trente personnes et douze étapes propose à chaque artiste la totalité du
 * pipe : douze départements pour quelqu'un qui n'en touche qu'un, et rien n'empêche
 * l'animateur de faire avancer une tâche de compositing par mégarde.
 *
 * Le réglage est du **studio**, pas du projet : la façon de travailler d'une maison ne
 * change pas d'un film à l'autre, et le régler par projet aurait produit des règles
 * différentes selon l'écran où l'on se trouve.
 *
 * Dans les deux modes, **tout le monde voit tout** : la production a besoin que chacun
 * sache où en sont les étapes voisines.
 */

const KEY = 'task_department_policy';

const OPTIONS: { value: string; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { value: 'open', labelKey: 'settings.taskPolicy.open', hintKey: 'settings.taskPolicy.open.hint' },
  {
    value: 'department',
    labelKey: 'settings.taskPolicy.department',
    hintKey: 'settings.taskPolicy.department.hint',
  },
];

export default function TaskPolicyField({
  stored,
  onSave,
}: {
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState(stored === 'department' ? 'department' : 'open');
  const hint = OPTIONS.find((o) => o.value === value)?.hintKey;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t('settings.taskPolicy')}</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="w-64 text-muted-foreground" htmlFor="task-department-policy">
          {t('settings.taskPolicy.label')}
        </label>
        <Select
          id="task-department-policy"
          className="py-1 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => void onSave(KEY, value)}>
          {t('common.apply')}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{t(hint)}</p>}
      <p className="text-xs text-muted-foreground">{t('settings.taskPolicy.visibility')}</p>
    </div>
  );
}
