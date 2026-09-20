// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SETTINGS_HOMES, fieldsFor, type SettingsHome } from './studioSettings';
import { fold, haystack, matchesQuery } from '../../components/settings/settingsFilter';
import type { MessageKey } from '../../i18n';

/**
 * Recherche dans les réglages du studio.
 *
 * Vingt-huit sections réparties en cinq groupes : pour trouver le watermark il fallait
 * savoir qu'il vit dans « Diffusion », et pour la rétention des journaux qu'elle n'est pas
 * au même endroit que celle de la corbeille. La recherche porte donc sur les **libellés de
 * réglages**, pas seulement sur les noms de sections.
 *
 * Deux index s'additionnent :
 *   1. `SECTION_KEYWORDS` — les mots qu'on emploie pour désigner une section ;
 *   2. `SECTION_SETTING_LABELS` — les réglages que la section rend **réellement**.
 *
 * Le second manquait presque entièrement : seuls les douze réglages clé/valeur de
 * `studioSettings` étaient indexés, pour une soixantaine effectivement rendus. Chercher
 * « CRF », « slate », « STARTTLS », « taille de lot » ou « scopes » ne trouvait rien —
 * c'est-à-dire exactement les réglages qu'on ne retrouve pas de tête.
 *
 * Le moteur (repli des accents, tous les mots exigés) est celui des trois familles
 * d'écrans : `components/settings/settingsFilter`.
 */

export { fold };

/**
 * Mots-clés supplémentaires par section, en plus de son libellé traduit.
 *
 * Volontairement en anglais **et** en français : un studio francophone cherche « filigrane »
 * autant que « watermark », et les termes de production restent en anglais partout.
 */
export const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ['dashboard', 'tableau de bord', 'statistiques', 'stats'],
  activity: ['audit', 'journal', 'log', 'historique', 'history', 'trace'],
  identity: [
    'sso',
    'oidc',
    'google',
    'saml',
    'ldap',
    'connexion',
    'login',
    'mot de passe',
    'password',
    '2fa',
  ],
  'login-appearance': ['login', 'connexion', 'fond', 'background', 'logo', 'accroche', 'tagline'],
  system: ['systeme', 'cpu', 'memoire', 'memory', 'disque', 'disk', 'sante', 'health', 'licence', 'license'],
  settings: [
    'reglages',
    'settings',
    'studio',
    'nom',
    'name',
    'marque',
    'brand',
    'logo',
    'langue',
    'language',
    'accent',
    'theme',
    'source',
    'agpl',
  ],
  defaults: [
    'defauts',
    'defaults',
    'nomenclature',
    'prefixe',
    'prefix',
    'resolution',
    'cadence',
    'fps',
    'departement',
    'department',
    'brouillon',
    'draft',
    'publication',
    'publish',
    'consigne',
    'brief',
  ],
  users: ['utilisateurs', 'users', 'comptes', 'accounts', 'roles', 'invitation', 'invite'],
  projects: ['projets', 'projects', 'archive', 'quota'],
  versions: ['versions', 'publication', 'publish', 'decision'],
  comments: ['commentaires', 'comments', 'notes', 'annotations'],
  storage: [
    'stockage',
    'storage',
    'minio',
    's3',
    'bucket',
    'derives',
    'derived',
    'quarantaine',
    'quarantine',
  ],
  visibility: ['masque', 'hidden', 'visibility', 'regle', 'rule', 'filtre', 'filter'],
  hdri: ['3d', 'splat', 'hdri', 'eclairage', 'lighting', 'environnement', 'environment'],
  ocio: ['couleur', 'color', 'ocio', 'aces', 'lut', 'display', 'view', 'colorspace'],
  video: [
    'video',
    'transcodage',
    'transcode',
    'hls',
    'proxy',
    'crf',
    'x264',
    'encodage',
    'encoding',
    'rendition',
  ],
  distribution: [
    'diffusion',
    'watermark',
    'filigrane',
    'burn-in',
    'burnin',
    'slate',
    'logo',
    'partage',
    'share',
  ],
  'review-statuses': ['statuts', 'status', 'decision', 'review', 'approbation', 'approval', 'retake'],
  announcements: ['annonces', 'announcements', 'message', 'banniere', 'banner'],
  smtp: ['smtp', 'email', 'mail', 'courriel', 'expediteur', 'sender', 'starttls', 'relais', 'relay'],
  api: ['api', 'webhook', 'token', 'jeton', 'integration', 'hmac'],
  'service-tokens': [
    'token',
    'jeton',
    'service',
    'machine',
    'ferme de rendu',
    'render farm',
    'bot',
    'daemon',
    'scope',
    'portee',
  ],
  shotgrid: ['shotgrid', 'sg', 'flow', 'autodesk', 'site', 'synchronisation', 'sync'],
  updates: [
    'mise a jour',
    'update',
    'upgrade',
    'sauvegarde',
    'backup',
    'restauration',
    'restore',
    'retour arriere',
    'rollback',
    'agent',
    'github',
    'changelog',
    'nouveautes',
  ],
  jobs: ['jobs', 'files', 'queue', 'ffmpeg', 'transcodage', 'worker', 'echecs', 'failed', 'purge'],
  trash: ['corbeille', 'trash', 'suppression', 'delete', 'restaurer', 'restore'],
  retention: ['retention', 'conservation', 'purge', 'journaux', 'logs', 'duree', 'duration', 'rgpd', 'gdpr'],
  'media-access': ['acces', 'access', 'medias', 'media', 'consultation', 'journal', 'log'],
  live: ['live', 'salle', 'room', 'direct', 'session', 'cadence', 'hz', 'synchronisation', 'sync'],
  chat: ['slack', 'discord', 'chat', 'messagerie', 'notification', 'webhook', 'equipe', 'team'],
};

/**
 * Les réglages que chaque section rend, par leur clé de libellé.
 *
 * Relevé sur les écrans eux-mêmes : c'est la liste que la recherche indexe en plus des
 * mots-clés, et le seul moyen que « clé HMAC », « débit audio » ou « taille de lot »
 * mènent quelque part. Une section absente d'ici n'expose pas de réglage nommé (listes,
 * journaux) et se trouve par ses mots-clés.
 */
export const SECTION_SETTING_LABELS: Partial<Record<string, MessageKey[]>> = {
  settings: ['settings.studioName', 'settings.accentColour', 'reviewStatus.defaultLang', 'burnin.studioLogo'],
  identity: [
    'sso.oidcTitle',
    'sso.enable',
    'sso.issuer',
    'sso.clientId',
    'sso.clientSecret',
    'sso.appUrl',
    'sso.autoCreate',
    'sso.buttonLabel',
    'sso.logoTitle',
    'sso.passwordTitle',
    'sso.passwordDisable',
  ],
  'login-appearance': [
    'login.appearance.background',
    'login.appearance.blur',
    'login.appearance.fit',
    'login.appearance.layout',
    'login.appearance.overlay',
    'login.appearance.showLogo',
    'login.appearance.tagline',
  ],
  system: ['system.licenseTitle', 'system.thirdParty', 'system.resources', 'system.platform'],
  defaults: [
    'defaults.formatRate',
    'defaults.naming',
    'defaults.departments',
    'pipeline.width',
    'pipeline.height',
    'pipeline.fps',
    'pipeline.prefix.sequence',
    'pipeline.prefix.shot',
    'pipeline.step',
    'pipeline.digits',
    'settings.draftMode',
    'settings.taskPolicy',
    'reviewRequest.title',
    'burnin.title',
  ],
  storage: ['storage.totalUsage', 'storage.originals', 'storage.derived', 'storage.byLocation'],
  visibility: [
    'visibility.newRule',
    'visibility.form.entityType',
    'visibility.form.pattern',
    'visibility.form.matchType',
  ],
  hdri: ['hdri.library', 'hdri.add'],
  ocio: ['ocio.installed', 'ocio.setDefault', 'ocio.acesReleases'],
  video: [
    'transcode.renditions',
    'transcode.adaptiveHls',
    'transcode.singleProxy',
    'transcode.crf',
    'transcode.preset',
    'transcode.audioKbps',
    'transcode.maxPx',
    'transcode.sceneDetect',
  ],
  distribution: [
    'dist.watermarkTitle',
    'dist.accountName',
    'dist.linkNameDate',
    'review.opacity',
    'burnin.title',
    'burnin.slateShort',
    'burnin.timecode',
    'burnin.shotCode',
    'burnin.versionName',
    'burnin.freeText',
    'burnin.studioLogo',
  ],
  'review-statuses': ['reviewStatus.new', 'reviewStatus.approval', 'reviewStatus.retake', 'common.color'],
  smtp: [
    'common.host',
    'smtp.port',
    'common.user',
    'login.password',
    'smtp.from',
    'smtp.secure',
    'smtp.allowInsecure',
    'smtp.sendTest',
  ],
  api: ['webhooks.scope', 'webhooks.hmacSecret', 'webhooks.deliveries', 'tokens.studio'],
  'service-tokens': [
    'tokens.service.new',
    'tokens.allProjects',
    'tokens.expired',
    'tokens.read',
    'tokens.write',
  ],
  shotgrid: [
    'shotgrid.site.name',
    'shotgrid.site.baseUrl',
    'shotgrid.site.authMode',
    'shotgrid.site.scriptName',
    'shotgrid.site.scriptKey',
    'shotgrid.site.login',
    'shotgrid.site.password',
  ],
  updates: [
    'ops.latest.title',
    'ops.backups.title',
    'ops.backups.create',
    'ops.backups.check',
    'about.version',
  ],
  jobs: ['jobs.purgeDerived', 'jobs.purgeFailed', 'versions.keep', 'jobs.retry'],
  retention: ['retention.title', 'retention.batchTitle', 'retention.batchSize'],
  announcements: ['admin.announce.new', 'admin.announce.everyRole'],
  trash: ['settings.trashRetention', 'common.restore', 'common.deletePermanently'],
};

/**
 * Index de recherche d'une section : son libellé, son identifiant, ses mots-clés, et les
 * libellés des réglages qu'elle rend.
 */
export function sectionHaystack(key: string, label: string, t: (k: MessageKey) => string): string {
  const parts: (string | undefined)[] = [label, key, ...(SECTION_KEYWORDS[key] ?? [])];
  // Les réglages clé/valeur sont indexés dans la section qui les rend : « uploads
  // simultanés » mène à « Stockage », « rétention corbeille » à « Rétention ».
  if (isSettingsHome(key)) parts.push(...fieldsFor(key).map((f) => t(f.labelKey)));
  parts.push(...(SECTION_SETTING_LABELS[key] ?? []).map((labelKey) => t(labelKey)));
  return haystack(parts);
}

/** La section rend-elle des réglages clé/valeur ? */
const isSettingsHome = (key: string): key is SettingsHome =>
  (SETTINGS_HOMES as readonly string[]).includes(key);

/** La section répond-elle à la recherche ? Une recherche vide laisse tout passer. */
export function sectionMatches(hay: string, query: string): boolean {
  return matchesQuery(hay, query);
}
