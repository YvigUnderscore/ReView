// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WidgetsPref } from '../lib/widgetLayout';

/**
 * UI preferences per account — GET/PATCH /api/users/me/preferences (shallow merge, `null` =
 * key removal). Open bag: each feature adds its own key.
 */
export interface UserPreferences {
  /** Daily email digest (backlog P2). */
  emailDigest?: boolean;
  /** Weekly production report by email (43.B — supervisors/admins). */
  weeklyReport?: boolean;
  /**
   * Notification settings per event type (lot 9): kind → channel → enabled.
   * Absent, or channel absent, means **enabled** — the exact shape and the list of kinds live in
   * `lib/notificationKinds`, copied from the server.
   */
  notifications?: Record<string, { inApp?: boolean; push?: boolean }>;
  /** Last annotation colour chosen in review. */
  annotationColor?: string;
  /** Overrides of global keyboard shortcuts (42.A2): action id → key. */
  shortcuts?: Record<string, string>;
  /**
   * Saved list views (42.A5 — №73), key = list scope: "reviews", "kanban:12", "shots:12"…
   * A single mechanism since C4 — the kanban used to have its own (`kanbanViews`), incompatible
   * with the rest of the application.
   */
  savedViews?: Record<string, SavedView[]>;
  /** Onboarding tour seen (42.B — №69): stop showing it automatically. */
  onboardingSeen?: boolean;
  /**
   * Home layout (C2): hidden blocks, a single order and per-block settings.
   * `null` = default layout. The former shape (`order` per column) is ignored on read — the frozen
   * columns are gone.
   */
  homeWidgets?: WidgetsPref | null;
  /**
   * Layout of a project's overview (lot 10): same shape as `homeWidgets`, and **a single one for
   * all projects** — one does not relearn one's page for every project.
   * `null` removes the key: the page then restarts from the default set for the role.
   */
  projectOverview?: WidgetsPref | null;
  /**
   * Interface language, i18n registry code. Attached to the account rather than the device: the
   * server needs it to send emails in the right language.
   */
  locale?: string;
  /**
   * Display density (A2): tracked by the account so that a new workstation picks up the setting.
   * An explicit choice made on the device takes precedence.
   */
  density?: 'comfortable' | 'compact';
  /**
   * Default list view (cards or compact), attached to the account: it follows from one workstation
   * to another, whereas the localStorage mirror only serves the first render.
   */
  viewMode?: 'cards' | 'compact';
  /**
   * Per-list overrides, key = scope ("shots:12", "assets:12"). Absent = the list follows
   * `viewMode`. A grid of shots is read as thumbnails, a list of tasks as rows: a single setting
   * cannot answer for both.
   */
  viewModes?: Record<string, 'cards' | 'compact'>;
  [key: string]: unknown;
}

/** A named list view: a set of filters to recall in one click. */
export interface SavedView {
  id: string;
  name: string;
  /** Captured filters (filter key → value), specific to the list's scope. */
  filters: Record<string, string>;
}
