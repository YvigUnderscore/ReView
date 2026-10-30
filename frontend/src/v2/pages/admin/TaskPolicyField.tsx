// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ListChecks } from 'lucide-react';
import { Select } from '../../components/ui/select';
import SettingsRow from '../../components/settings/SettingsRow';
import { Panel } from './AdminPrimitives';
import { useT, type MessageKey } from '../../i18n';

/**
 * Who may write on a task.
 *
 * A studio of thirty people and twelve steps offers each artist the whole
 * pipe: twelve departments for someone who touches only one, and nothing prevents
 * the animator from accidentally moving a compositing task forward.
 *
 * The setting belongs to the **studio**, not the project: a house's way of working
 * does not change from one film to the next, and setting it per project would have produced rules
 * that differ depending on the screen one is on. It lives with the departments it bounds,
 * in the project defaults — and no longer alone, with its own button, in the middle of
 * quotas and webhooks.
 *
 * In both modes, **everyone sees everything**: production needs each person
 * to know where the neighbouring steps stand.
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
