// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { usePreferences, useUpdatePreferences } from '../../../lib/usePreferences';
import { useProjectRole } from '../../../lib/useProjectRole';
import { useAuth } from '../../../stores/useAuth';
import type { WidgetsPref } from '../../../lib/widgetLayout';
import type { Role } from '../../../types/api';
import { useT } from '../../../i18n';
import { OVERVIEW_PREFERENCE_KEY, resolveOverviewLayout, roleLayout } from './overviewWidgets';

/** Response of `GET /api/studio/overview-layout`: an absent role has never been set. */
interface RoleDefaultsResponse {
  defaults: Partial<Record<Role, WidgetsPref>>;
}

export interface OverviewLayoutState {
  /** Layout to render: the person's, completed by their role's default. */
  layout: WidgetsPref;
  /** What the person has set themselves: absent as long as they have changed nothing. */
  personal: WidgetsPref | undefined;
  role: Role | null;
  canManage: boolean;
  isAdmin: boolean;
  /** Roles for which the administration has saved a default: the only ones that can be removed. */
  definedRoles: Role[];
  /** False until the preferences have answered: writing before then would overwrite them. */
  ready: boolean;
  save: (next: WidgetsPref) => void;
  /** Clears the customization: the page returns to its role default. */
  useRoleDefault: () => void;
  saveRoleDefault: (role: Role, layout: WidgetsPref | null) => void;
}

/**
 * Overview layout: the person's, their role's default, and the gestures that write either one.
 *
 * Two sources, two scopes. The account preference (`preferences.projectOverview`) follows the
 * person from one project to another: one does not relearn one's page for each project. The
 * per-role default is a studio setting, served to whoever has customized nothing.
 *
 * The role retained is the role **effective on this project** (`useProjectRole`), not the account's
 * role: someone who supervises one project and executes on another does not open the same page on
 * both sides, and that is indeed what is wanted.
 */
export function useOverviewLayout(projectId: number): OverviewLayoutState {
  const t = useT();
  const qc = useQueryClient();
  const globalRole = useAuth((s) => s.user?.role);
  const { role, canManage } = useProjectRole(projectId);
  const prefsQ = usePreferences();
  const updatePrefs = useUpdatePreferences();

  const defaultsQ = useQuery({
    queryKey: qk.overviewLayoutDefaults,
    queryFn: () => api.get<RoleDefaultsResponse>('/api/studio/overview-layout').then((d) => d.defaults),
    staleTime: 5 * 60_000,
  });

  const saveDefault = useMutation({
    mutationFn: (body: { role: Role; layout: WidgetsPref | null }) =>
      api.put<RoleDefaultsResponse>('/api/studio/overview-layout', body).then((d) => d.defaults),
    onSuccess: (defaults) => {
      qc.setQueryData(qk.overviewLayoutDefaults, defaults);
      toast.success(t('overview.roleDefaultSaved'));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // The key is typed in `UserPreferences`: no cast, hence no assumed shape. `null` (cleared key) and
  // absence say the same thing: nothing customized.
  const personal = prefsQ.data?.projectOverview ?? undefined;
  const forRole = roleLayout(defaultsQ.data, role);

  // The preferences have not arrived yet: composing now would overwrite the saved layout, since the
  // server merges the `projectOverview` key as a whole block.
  const ready = !prefsQ.isPending;

  return {
    layout: resolveOverviewLayout(personal, forRole),
    personal,
    role,
    canManage,
    isAdmin: globalRole === 'ADMIN',
    definedRoles: Object.keys(defaultsQ.data ?? {}) as Role[],
    ready,
    save: (next) => {
      if (ready) updatePrefs.mutate({ [OVERVIEW_PREFERENCE_KEY]: next });
    },
    // `null` removes the key server-side (shallow merge): the page starts again from the role
    // default, including the one the administration will set later.
    useRoleDefault: () => {
      if (ready) updatePrefs.mutate({ [OVERVIEW_PREFERENCE_KEY]: null });
    },
    saveRoleDefault: (target, layout) => saveDefault.mutate({ role: target, layout }),
  };
}
