// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey, Tr } from '../../i18n';

/**
 * Les écrans de réglages : leur clé — qui **est** leur route, `/admin/<clé>` —, le groupe
 * où ils se rangent et leur libellé traduit.
 *
 * Cette table vivait dans `AdminPage`, mêlée aux icônes et aux composants d'onglet. Deux
 * écrans en ont désormais besoin : la page d'administration, et la palette Ctrl+K, qui doit
 * pouvoir répondre à « où règle-t-on le watermark » sans importer les vingt-huit onglets.
 * L'extraire plutôt que la recopier est le seul moyen qu'un renommage de section n'atteigne
 * pas la palette avec un train de retard.
 *
 * L'ordre est celui de la barre latérale : il porte du sens (le tableau de bord d'abord,
 * la maintenance en dernier) et sert de départage aux résultats de recherche.
 */

/** Groupes de la barre latérale — clé stable, libellé traduit au rendu. */
export const ADMIN_GROUPS = ['studio', 'content', 'reviewContexts', 'communications', 'maintenance'] as const;

export type AdminGroup = (typeof ADMIN_GROUPS)[number];

/** Libellé traduit d'un groupe. */
export const adminGroupLabel = (t: Tr, group: AdminGroup): string => t(`admin.group.${group}` as MessageKey);

/** Forme d'une entrée — `satisfies` ci-dessous en fait un contrat, littéraux conservés. */
interface AdminSectionShape {
  key: string;
  group: AdminGroup;
  label: string;
}

/**
 * Trois libellés ne passent pas par `t()` : « Versions », « SMTP » et « 3D & Splat » sont
 * du vocabulaire de production ou des sigles, que `scripts/i18n-glossary.json` interdit
 * justement de traduire.
 */
export const adminSections = (t: Tr) =>
  [
    { key: 'overview', group: 'studio', label: t('admin.tab.dashboard') },
    { key: 'activity', group: 'studio', label: t('admin.tab.activity') },
    { key: 'identity', group: 'studio', label: t('admin.tab.identity') },
    { key: 'login-appearance', group: 'studio', label: t('admin.tab.loginAppearance') },
    { key: 'system', group: 'studio', label: t('admin.tab.system') },
    { key: 'settings', group: 'studio', label: t('admin.tab.settings') },
    { key: 'defaults', group: 'studio', label: t('admin.tab.projectDefaults') },
    { key: 'users', group: 'content', label: t('admin.tab.users') },
    { key: 'projects', group: 'content', label: t('nav.projects') },
    { key: 'versions', group: 'content', label: 'Versions' },
    { key: 'comments', group: 'content', label: t('admin.tab.comments') },
    { key: 'storage', group: 'content', label: t('storage.title') },
    // Le masquage vit avec le contenu, pas avec la maintenance : c'est une décision de
    // production sur ce qui s'affiche, pas une opération d'exploitation.
    { key: 'visibility', group: 'content', label: t('admin.tab.visibility') },
    { key: 'hdri', group: 'reviewContexts', label: '3D & Splat' },
    { key: 'ocio', group: 'reviewContexts', label: t('admin.tab.color') },
    { key: 'video', group: 'reviewContexts', label: t('admin.tab.video') },
    { key: 'distribution', group: 'reviewContexts', label: t('review.delivery') },
    { key: 'review-statuses', group: 'reviewContexts', label: t('admin.tab.statuses') },
    { key: 'announcements', group: 'communications', label: t('admin.tab.announcements') },
    { key: 'smtp', group: 'communications', label: 'SMTP' },
    { key: 'api', group: 'communications', label: t('admin.tab.api') },
    // Identités machine (ferme de rendu, daemon Prism, bot) : à côté de l'API, dont elles
    // sont le poste d'entrée — mais dans leur propre écran, le formulaire d'émission
    // portant rôle, projet, expiration et scopes fins.
    { key: 'service-tokens', group: 'communications', label: t('admin.tab.serviceTokens') },
    { key: 'shotgrid', group: 'communications', label: t('shotgrid.tab.label') },
    { key: 'jobs', group: 'maintenance', label: t('admin.tab.jobs') },
    { key: 'trash', group: 'maintenance', label: t('admin.tab.trash') },
    { key: 'retention', group: 'maintenance', label: t('admin.tab.retention') },
    { key: 'media-access', group: 'maintenance', label: t('admin.tab.mediaAccess') },
  ] as const satisfies readonly AdminSectionShape[];

/** Une section d'administration, telle que la rendent la barre latérale et la palette. */
export type AdminSection = ReturnType<typeof adminSections>[number];

/**
 * Clé d'une section. Union littérale, et non `string` : c'est elle qui oblige `AdminPage`
 * à fournir un écran pour chaque entrée — une section ajoutée ici sans onglet en face ne
 * compile pas, au lieu de rendre une page blanche.
 */
export type AdminSectionKey = AdminSection['key'];
