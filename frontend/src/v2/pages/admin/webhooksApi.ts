// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';

export interface WebhookRow {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  /** Scope: `null` = the whole studio; otherwise, this project and only it. */
  projectId: number | null;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
  failureStreak: number;
  createdAt: string;
}

export const webhooksKey = qk.admin('webhooks');

export function useWebhooksQuery() {
  return useQuery({
    queryKey: webhooksKey,
    queryFn: () => api.get<{ webhooks: WebhookRow[] }>('/api/admin/webhooks').then((d) => d.webhooks),
  });
}

export const webhooksApi = {
  /** Returns the signing secret, shown once. */
  create: (body: { url: string; events: string[]; projectId: number | null }) =>
    api.post<{ secret: string }>('/api/admin/webhooks', body),
  update: (id: number, body: Partial<Pick<WebhookRow, 'active' | 'projectId'>>) =>
    api.patch(`/api/admin/webhooks/${id}`, body),
  remove: (id: number) => api.del(`/api/admin/webhooks/${id}`),
  /** Queues a test delivery. */
  test: (id: number) => api.post(`/api/admin/webhooks/${id}/test`),
};
