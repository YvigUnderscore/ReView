// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey, Tr } from '../../i18n';

/**
 * Settings screens: their key, which **is** their route (`/admin/<key>`), their group
 * and their translated label.
 *
 * This table used to live in `AdminPage`, mixed with the icons and tab components. Two
 * screens now need it: the admin page, and the Ctrl+K palette, which must be able to
 * answer "where is the watermark set" without importing the twenty-eight tabs.
 * Extracting it rather than copying it is the only way a section rename cannot reach
 * the palette a train late.
 *
 * The order is that of the sidebar: it carries meaning (dashboard first,
 * maintenance last) and breaks ties in search results.
 */

/** Sidebar groups: stable key, translated label at render time. */
export const ADMIN_GROUPS = ['studio', 'content', 'reviewContexts', 'communications', 'maintenance'] as const;

export type AdminGroup = (typeof ADMIN_GROUPS)[number];

/** Translated label of a group. */
export const adminGroupLabel = (t: Tr, group: AdminGroup): string => t(`admin.group.${group}` as MessageKey);

/** Entry shape: `satisfies` below makes it a contract, literals kept. */
interface AdminSectionShape {
  key: string;
  group: AdminGroup;
  label: string;
}

/**
 * Three labels do not go through `t()`: "Versions", "SMTP" and "3D & Splat" are
 * production vocabulary or acronyms, which `scripts/i18n-glossary.json` precisely
 * forbids translating.
 */
export const adminSections = (t: Tr) =>
  [
    { key: 'overview', group: 'studio', label: t('admin.tab.dashboard') },
    { key: 'activity', group: 'studio', label: t('admin.tab.activity') },
    { key: 'identity', group: 'studio', label: t('admin.tab.identity') },
    { key: 'login-appearance', group: 'studio', label: t('admin.tab.loginAppearance') },
    { key: 'system', group: 'studio', label: t('admin.tab.system') },
    // "Settings" no longer means a catch-all but the instance's identity: its name,
    // colour, default language, logo, and the address of its sources. The word
    // "Settings" now names the whole page, not one section among twenty-nine.
    { key: 'settings', group: 'studio', label: t('settings.group.studio') },
    { key: 'defaults', group: 'studio', label: t('admin.tab.projectDefaults') },
    { key: 'users', group: 'content', label: t('admin.tab.users') },
    { key: 'projects', group: 'content', label: t('nav.projects') },
    { key: 'versions', group: 'content', label: 'Versions' },
    { key: 'comments', group: 'content', label: t('admin.tab.comments') },
    { key: 'storage', group: 'content', label: t('storage.title') },
    // Hiding lives with the content, not with maintenance: it is a production
    // decision about what is displayed, not an operations task.
    { key: 'visibility', group: 'content', label: t('admin.tab.visibility') },
    { key: 'hdri', group: 'reviewContexts', label: '3D & Splat' },
    { key: 'ocio', group: 'reviewContexts', label: t('admin.tab.color') },
    { key: 'video', group: 'reviewContexts', label: t('admin.tab.video') },
    { key: 'distribution', group: 'reviewContexts', label: t('review.delivery') },
    { key: 'review-statuses', group: 'reviewContexts', label: t('admin.tab.statuses') },
    // The four broadcast cadences of the live room only make sense together: they
    // used to take a quarter of the old catch-all section, now they have their own screen.
    { key: 'live', group: 'reviewContexts', label: t('settings.group.live') },
    { key: 'announcements', group: 'communications', label: t('admin.tab.announcements') },
    { key: 'smtp', group: 'communications', label: 'SMTP' },
    { key: 'api', group: 'communications', label: t('admin.tab.api') },
    // Machine identities (render farm, Prism daemon, bot): next to the API, of which
    // they are the entry point, but in their own screen, since the issuing form
    // carries role, project, expiry and fine-grained scopes.
    { key: 'service-tokens', group: 'communications', label: t('admin.tab.serviceTokens') },
    { key: 'shotgrid', group: 'communications', label: t('shotgrid.tab.label') },
    // Slack and Discord: the same action ("notify the team"), half of which had
    // no screen even though the API exposes it.
    { key: 'chat', group: 'communications', label: t('admin.tab.chat') },
    // At the top of maintenance: this is the action one comes looking for when a version
    // appears, and the one one wants to find without searching on the day of an outage.
    { key: 'updates', group: 'maintenance', label: t('admin.tab.updates') },
    { key: 'jobs', group: 'maintenance', label: t('admin.tab.jobs') },
    { key: 'trash', group: 'maintenance', label: t('admin.tab.trash') },
    { key: 'retention', group: 'maintenance', label: t('admin.tab.retention') },
    { key: 'media-access', group: 'maintenance', label: t('admin.tab.mediaAccess') },
  ] as const satisfies readonly AdminSectionShape[];

/** An admin section, as rendered by the sidebar and the palette. */
export type AdminSection = ReturnType<typeof adminSections>[number];

/**
 * Section key. Literal union, not `string`: it is what forces `AdminPage`
 * to provide a screen for each entry; a section added here without a matching tab
 * does not compile, instead of rendering a blank page.
 */
export type AdminSectionKey = AdminSection['key'];
