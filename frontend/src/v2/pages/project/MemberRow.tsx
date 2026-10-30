// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Layers, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import Avatar from '../../components/Avatar';
import { DeleteIcon } from '../../components/EntityCard';
import EntityContextMenu from '../../components/ui/entity-menu';
import SgAccountLink from '../../components/shotgrid/SgAccountLink';
import { useDepartments, useToggleMemberDepartment } from '../../lib/departmentsApi';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import { initialsFrom } from '../../lib/initials';
import { personLabel } from '../../lib/peopleSearch';
import { ROLE_LABEL_KEY } from '../../lib/userStatus';
import { useT, type MessageKey } from '../../i18n';
import type { MenuEntry } from '../../lib/menuSpec';
import type { Member } from './projectTypes';
import type { Role } from '../../types/api';

/**
 * A person on the project: their role and their departments.
 *
 * The per-project role was already adjustable (38.E). The department, however, had no screen: the
 * relation existed since wave B, and only the API knew how to write it. Both are now set in the
 * same place, on right-click, where one already looks at the person.
 *
 * **An artist belongs to SEVERAL departments.** This is a choice, not a modelling convenience: a
 * compositing lead who also does roto, or a generalist who moves from layout to lighting. The boxes
 * are ticked independently, and each toggle is sent on its own: two quick clicks must not cancel
 * each other out.
 */

/** Project role: optional override of the global role (38.E). `GLOBAL` means inherit. */
const INHERIT = 'GLOBAL';
const ROLE_VALUES = [INHERIT, 'SUPERVISOR', 'ARTIST', 'CLIENT'] as const;
const ROLE_KEY: Record<(typeof ROLE_VALUES)[number], MessageKey> = {
  GLOBAL: 'members.role.global',
  SUPERVISOR: 'members.role.supervisor',
  ARTIST: 'members.role.artist',
  CLIENT: 'members.role.client',
};

export default function MemberRow({
  projectId,
  member,
  sgLinked,
  canManage,
  onRole,
  onRemove,
}: {
  projectId: number;
  member: Member;
  /** Project linked to a site: the account matching then shows on the row. */
  sgLinked: boolean;
  canManage: boolean;
  onRole: (userId: number, role: Role | undefined) => void;
  onRemove: (userId: number) => void;
}) {
  const t = useT();
  const isDark = useTheme((s) => s.theme) === 'dark';
  const { data: departments = [] } = useDepartments(projectId, canManage);
  const toggle = useToggleMemberDepartment(projectId, member.user.id);
  const own = member.user.departments ?? [];
  const ownIds = new Set(own.map((d) => d.id));
  /**
   * What the menu offers: the project's pipeline, **plus** what the person already carries.
   *
   * The two lists do not always coincide. A project that declares its own steps hides the studio's
   * in the menus (`listForProject`), whereas the member sheet renders both. That is the truth, and
   * hiding it would be worse. Without this union, a studio step displayed as a badge with no box to
   * untick it.
   */
  const choices = [...departments, ...own.filter((d) => !departments.some((p) => p.id === d.id))];

  const setDepartment = (id: number, checked: boolean) => {
    toggle.mutate(checked ? { add: [id] } : { remove: [id] }, {
      onSuccess: () => toast.success(t('departments.updated')),
      onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
    });
  };

  const entries: MenuEntry[] = canManage
    ? [
        {
          kind: 'submenu',
          id: 'member-role',
          label: t('members.roleOnProject'),
          icon: <UserCog size={14} />,
          items: [
            {
              kind: 'radiogroup',
              id: 'member-role-group',
              value: member.role ?? INHERIT,
              onValueChange: (value) =>
                onRole(member.user.id, value === INHERIT ? undefined : (value as Role)),
              items: ROLE_VALUES.map((value) => ({
                id: `member-role-${value}`,
                value,
                label: t(ROLE_KEY[value]),
              })),
            },
          ],
        },
        {
          kind: 'submenu',
          id: 'member-departments',
          label: t('departments.menu'),
          icon: <Layers size={14} />,
          items: choices.length
            ? choices.map((d) => ({
                kind: 'checkbox' as const,
                id: `member-dept-${d.id}`,
                label: d.name,
                checked: ownIds.has(d.id),
                disabled: toggle.isPending,
                onCheckedChange: (checked: boolean) => setDepartment(d.id, checked),
              }))
            : [
                {
                  id: 'member-dept-empty',
                  label: t('entity.settings.noDepartment'),
                  disabled: true,
                  onSelect: () => undefined,
                },
              ],
        },
      ]
    : [];

  return (
    <EntityContextMenu entries={entries}>
      <div className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar
            seed={member.user.id}
            initials={initialsFrom(personLabel(member.user))}
            avatarUrl={member.user.avatarUrl}
            size={28}
          />
          <div className="min-w-0">
            {/* Same identity as in the add directory: nickname honoured, role readable. */}
            <span className="text-sm font-medium">{personLabel(member.user)}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {member.user.email} · {t(ROLE_LABEL_KEY[member.user.role])}
            </span>
            <MemberDepartments departments={own} isDark={isDark} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* ShotGrid account: the email address is not always enough to match the two. */}
          {sgLinked && <SgAccountLink projectId={projectId} userId={member.user.id} />}
          <select
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            value={member.role ?? ''}
            onChange={(e) => onRole(member.user.id, e.target.value ? (e.target.value as Role) : undefined)}
            title={t('members.roleOnProject')}
            aria-label={t('members.roleOnProject')}
          >
            {ROLE_VALUES.map((value) => (
              <option key={value} value={value === INHERIT ? '' : value}>
                {t(ROLE_KEY[value])}
              </option>
            ))}
          </select>
          <button
            onClick={() => onRemove(member.user.id)}
            title={t('common.remove')}
            aria-label={t('common.remove')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-destructive opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
          >
            {DeleteIcon}
          </button>
        </div>
      </div>
    </EntityContextMenu>
  );
}

/** The person's departments, in the pipeline's tint. */
function MemberDepartments({
  departments,
  isDark,
}: {
  departments: NonNullable<Member['user']['departments']>;
  isDark: boolean;
}) {
  const t = useT();
  if (departments.length === 0)
    return <p className="mt-0.5 text-2xs text-muted-foreground">{t('members.noDepartment')}</p>;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {departments.map((d) => {
        // The colour comes from the database: normalized, otherwise a light yellow used as a
        // background would become unreadable on the dark theme.
        const swatch = statusSwatch(d.color, isDark);
        return (
          <span
            key={d.id}
            style={swatch ?? undefined}
            className={`rounded-full px-2 py-0.5 text-2xs ${swatch ? '' : 'bg-secondary text-foreground'}`}
          >
            {d.name}
          </span>
        );
      })}
    </div>
  );
}
