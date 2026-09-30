// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import { bytesToUnit, parseSizeToBytes, type SizeUnit } from './adminShared';

/**
 * Les réglages clé/valeur du studio (`/api/studio/settings`) — et surtout **la section où
 * on va les chercher**.
 *
 * `/admin/settings` empilait quatorze réglages sans rapport : frame de départ, taille de
 * fichier, quota, uploads simultanés, rétention de la corbeille, quatre cadences de salle
 * live, webhook Slack, URL des sources AGPL, politique de tâches, langue et accent. Les
 * ranger en familles à l'intérieur d'un même écran n'a jamais répondu à la vraie question :
 * personne ne cherche « le quota » dans « Réglages », on le cherche dans « Stockage ».
 *
 * Chaque champ déclare donc sa **maison** — la section d'administration qui le rend. Le
 * champ n'a plus qu'un seul endroit possible, et la recherche de réglages indexe la bonne
 * section sans table parallèle.
 */

/** Sections qui rendent au moins un réglage clé/valeur. Ce sont des clés de `adminSections`. */
export const SETTINGS_HOMES = ['settings', 'storage', 'defaults', 'retention', 'live', 'chat'] as const;

export type SettingsHome = (typeof SETTINGS_HOMES)[number];

export interface SettingField {
  key: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  /** Section d'administration qui rend ce champ. */
  home: SettingsHome;
  /** Champ exprimé en taille (Mo/Go) — saisie convertie en octets à l'enregistrement. */
  bytes?: boolean;
}

export const SETTINGS_FIELDS: SettingField[] = [
  // Défauts de projet : la frame de départ est un défaut de création, pas un réglage
  // d'instance — elle vit avec la résolution et la cadence qu'elle accompagne.
  {
    key: 'default_start_frame',
    labelKey: 'settings.defaultStartFrame',
    hintKey: 'settings.hint.startFrame',
    home: 'defaults',
  },
  // Téléversements et quotas : ce sont des limites de stockage, et « Stockage » est l'écran
  // qui montre déjà ce que le bucket contient. Le quota par défaut fait autorité ici ; la
  // fiche d'un compte n'en donne qu'une surcharge.
  {
    key: 'max_file_size',
    labelKey: 'settings.maxFileSize',
    hintKey: 'settings.hint.maxFileSize',
    home: 'storage',
    bytes: true,
  },
  {
    key: 'storage_limit_user',
    labelKey: 'settings.storageQuota',
    hintKey: 'settings.hint.storageQuota',
    home: 'storage',
    bytes: true,
  },
  {
    key: 'max_concurrent_uploads',
    labelKey: 'settings.maxUploads',
    hintKey: 'settings.hint.maxUploads',
    home: 'storage',
  },
  // Rétention : la corbeille et les journaux répondent à la même question — combien de
  // temps le studio garde-t-il ce qu'il a supprimé. Les séparer obligeait à connaître deux
  // écrans pour répondre à une demande RGPD. La Corbeille renvoie ici.
  {
    key: 'trash_retention_days',
    labelKey: 'settings.trashRetention',
    hintKey: 'settings.hint.trash',
    home: 'retention',
  },
  // Salle de review live (33.B) : diffusions/seconde du pilote, par type de média (1–30).
  {
    key: 'live_sync_hz_video',
    labelKey: 'settings.liveVideo',
    hintKey: 'settings.hint.liveVideo',
    home: 'live',
  },
  {
    key: 'live_sync_hz_image',
    labelKey: 'settings.liveImage',
    hintKey: 'settings.hint.liveImage',
    home: 'live',
  },
  { key: 'live_sync_hz_3d', labelKey: 'settings.live3d', hintKey: 'settings.hint.liveCam', home: 'live' },
  {
    key: 'live_sync_hz_splat',
    labelKey: 'settings.liveSplat',
    hintKey: 'settings.hint.liveCamFocal',
    home: 'live',
  },
  // Messagerie d'équipe : Slack et Discord sont le même geste (« préviens l'équipe »),
  // rendus par le même écran — celui où le webhook Discord, exposé par l'API, avait jusque-là
  // aucun endroit où se régler.
  {
    key: 'slack_webhook_url',
    labelKey: 'settings.slackWebhook',
    hintKey: 'settings.hint.slack',
    home: 'chat',
  },
  // AGPL §13 : l'instance doit offrir SES sources. Vide = dépôt amont. C'est une mention
  // d'identité de l'instance, au même titre que son nom.
  {
    key: 'studio_source_url',
    labelKey: 'settings.sourceUrl',
    hintKey: 'settings.hint.sourceUrl',
    home: 'settings',
  },
];

/** Les champs que rend une section, dans l'ordre de déclaration. */
export const fieldsFor = (home: SettingsHome): SettingField[] =>
  SETTINGS_FIELDS.filter((field) => field.home === home);

/** Brouillon d'écran : les seules clés touchées depuis le chargement. */
export type SettingsDraft = Record<string, string>;
/** Unité choisie pour les champs exprimés en taille. */
export type SettingsUnits = Record<string, SizeUnit>;

/** Y a-t-il quelque chose à enregistrer ? C'est ce qui arme la barre d'action. */
export const isDirty = (draft: SettingsDraft): boolean => Object.keys(draft).length > 0;

/**
 * Valeur à afficher dans le champ : la saisie en cours si elle existe, sinon la valeur
 * enregistrée — remise dans l'unité lisible pour les tailles.
 */
export function fieldDisplay(field: SettingField, stored: Record<string, string>, draft: SettingsDraft) {
  const typed = draft[field.key];
  if (typed !== undefined) return typed;
  if (!field.bytes) return stored[field.key] ?? '';
  const raw = Number(stored[field.key]) || 0;
  return raw ? bytesToUnit(raw).value : '';
}

/** Unité affichée : celle qu'on vient de choisir, sinon celle que la valeur enregistrée impose. */
export function fieldUnit(
  field: SettingField,
  stored: Record<string, string>,
  units: SettingsUnits,
): SizeUnit {
  return units[field.key] ?? bytesToUnit(Number(stored[field.key]) || 0).unit;
}

/** Ce que le brouillon enverra, ou la clé du champ qui refuse d'être lu. */
export interface SettingsPayload {
  entries: { key: string; value: string }[];
  /** Clé du premier champ de taille illisible — l'enregistrement s'arrête là. */
  invalidKey: string | null;
}

/**
 * Traduit le brouillon en écritures.
 *
 * Une clé absente du brouillon n'est pas envoyée : deux administrateurs qui règlent deux
 * champs voisins ne s'écrasent pas l'un l'autre. Les champs de taille sont convertis en
 * octets selon l'unité affichée, et un nombre illisible interrompt tout l'enregistrement
 * plutôt que d'en écrire la moitié.
 */
export function settingsPayload(
  fields: SettingField[],
  draft: SettingsDraft,
  units: SettingsUnits,
): SettingsPayload {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const entries: { key: string; value: string }[] = [];
  for (const [key, typed] of Object.entries(draft)) {
    const field = byKey.get(key);
    if (!field?.bytes) {
      entries.push({ key, value: typed });
      continue;
    }
    const bytes = parseSizeToBytes(typed, units[key] ?? 'Mo');
    if (bytes == null) return { entries: [], invalidKey: key };
    entries.push({ key, value: String(bytes) });
  }
  return { entries, invalidKey: null };
}
