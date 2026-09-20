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

/** Réponse de `GET /api/studio/overview-layout` — un rôle absent n'a jamais été réglé. */
interface RoleDefaultsResponse {
  defaults: Partial<Record<Role, WidgetsPref>>;
}

export interface OverviewLayoutState {
  /** Disposition à rendre : la personne, complétée par le défaut de son rôle. */
  layout: WidgetsPref;
  /** Ce que la personne a elle-même réglé — absent tant qu'elle n'a rien changé. */
  personal: WidgetsPref | undefined;
  role: Role | null;
  canManage: boolean;
  isAdmin: boolean;
  /** Rôles pour lesquels l'administration a enregistré un défaut — les seuls à pouvoir être retirés. */
  definedRoles: Role[];
  /** Faux tant que les préférences n'ont pas répondu : écrire avant les écraserait. */
  ready: boolean;
  save: (next: WidgetsPref) => void;
  /** Efface la personnalisation : la page revient au défaut du rôle. */
  useRoleDefault: () => void;
  saveRoleDefault: (role: Role, layout: WidgetsPref | null) => void;
}

/**
 * Disposition de la vue d'ensemble : celle de la personne, le défaut de son rôle, et les
 * gestes qui écrivent l'une ou l'autre.
 *
 * Deux sources, deux portées. La préférence de compte (`preferences.projectOverview`) suit
 * la personne d'un projet à l'autre — on ne réapprend pas sa page à chaque projet. Le
 * défaut par rôle est un réglage studio, servi à qui n'a rien personnalisé.
 *
 * Le rôle retenu est le rôle **effectif sur ce projet** (`useProjectRole`), pas le rôle du
 * compte : quelqu'un qui supervise un projet et exécute sur un autre n'ouvre pas la même
 * page des deux côtés, et c'est bien ce qu'on veut.
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

  // La clé est typée dans `UserPreferences` : pas de transtypage, donc pas de forme
  // supposée. `null` (clé effacée) et absence disent la même chose — rien de personnalisé.
  const personal = prefsQ.data?.projectOverview ?? undefined;
  const forRole = roleLayout(defaultsQ.data, role);

  // Les préférences ne sont pas encore là : composer maintenant écraserait la disposition
  // enregistrée, le serveur fusionnant la clé `projectOverview` en bloc.
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
    // `null` supprime la clé côté serveur (merge superficiel) : la page repart du défaut du
    // rôle, y compris de celui que l'administration réglera plus tard.
    useRoleDefault: () => {
      if (ready) updatePrefs.mutate({ [OVERVIEW_PREFERENCE_KEY]: null });
    },
    saveRoleDefault: (target, layout) => saveDefault.mutate({ role: target, layout }),
  };
}
