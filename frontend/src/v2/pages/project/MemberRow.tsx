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
 * Une personne sur le projet : son rôle, ses départements.
 *
 * Le rôle par projet était déjà réglable (38.E) ; le département, lui, n'avait aucun écran
 * — la relation existait depuis la vague B et seule l'API savait l'écrire. Les deux se
 * posent maintenant au même endroit, au clic droit, là où l'on regarde déjà la personne.
 *
 * **Un artiste appartient à PLUSIEURS départements.** C'est un choix, pas une facilité de
 * modèle : un lead compositing qui tient aussi le roto, un généraliste qui passe du layout
 * au lighting. Les cases se cochent indépendamment, et chaque bascule est envoyée seule —
 * deux clics rapides ne doivent pas s'annuler l'un l'autre.
 */

/** Rôle projet : override facultatif du rôle global (38.E). `GLOBAL` = hérite. */
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
  /** Projet relié à un site : le rapprochement de comptes s'affiche alors sur la ligne. */
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
   * Ce que le menu propose : le pipe du projet, **plus** ce que la personne porte déjà.
   *
   * Les deux listes ne coïncident pas toujours. Un projet qui déclare ses propres étapes
   * masque celles du studio dans les menus (`listForProject`), alors que la fiche du membre
   * rend les deux — c'est la vérité, et la cacher serait pire. Sans cette réunion, une
   * étape du studio s'affichait en pastille sans qu'aucune case ne permette de la décocher.
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
            {/* Même identité que dans l'annuaire d'ajout : pseudo honoré, rôle lisible. */}
            <span className="text-sm font-medium">{personLabel(member.user)}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {member.user.email} · {t(ROLE_LABEL_KEY[member.user.role])}
            </span>
            <MemberDepartments departments={own} isDark={isDark} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Compte ShotGrid : l'adresse ne suffit pas toujours à rapprocher les deux. */}
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

/** Les départements de la personne, dans la teinte du pipe. */
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
        // La couleur vient de la base : normalisée, sinon un jaune clair posé en fond
        // devient illisible sur le thème sombre.
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
