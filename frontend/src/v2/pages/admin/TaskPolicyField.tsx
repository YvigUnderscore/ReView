// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ListChecks } from 'lucide-react';
import { Select } from '../../components/ui/select';
import SettingsRow from '../../components/settings/SettingsRow';
import { Panel } from './AdminPrimitives';
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
 * différentes selon l'écran où l'on se trouve. Il vit avec les départements qu'il borne,
 * dans les défauts de projet — et non plus seul, avec son propre bouton, au milieu des
 * quotas et des webhooks.
 *
 * Dans les deux modes, **tout le monde voit tout** : la production a besoin que chacun
 * sache où en sont les étapes voisines.
 */

export const TASK_POLICY_KEY = 'task_department_policy';

const OPTIONS: { value: string; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { value: 'open', labelKey: 'settings.taskPolicy.open', hintKey: 'settings.taskPolicy.open.hint' },
  {
    value: 'department',
    labelKey: 'settings.taskPolicy.department',
    hintKey: 'settings.taskPolicy.department.hint',
  },
];

export default function TaskPolicyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const current = value === 'department' ? 'department' : 'open';
  const hint = OPTIONS.find((o) => o.value === current)?.hintKey;

  return (
    <Panel title={t('settings.taskPolicy')} icon={ListChecks} tone="primary" footnote={hint && t(hint)}>
      <SettingsRow label={t('settings.taskPolicy.label')} htmlFor="task-department-policy">
        <Select
          id="task-department-policy"
          className="py-1 text-xs"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </Select>
      </SettingsRow>
    </Panel>
  );
}
