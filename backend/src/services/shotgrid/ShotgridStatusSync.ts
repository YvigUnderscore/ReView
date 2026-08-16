// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineStatus, ReviewStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { ShotgridClient } from './ShotgridClient';
import {
  asString,
  asNumber,
  rgbToHex,
  sgStatusIsApproval,
  sgStatusIsDone,
  sgStatusIsInactive,
  sgStatusIsRetake,
  sgStatusToEnum,
} from './shotgridMapper';
import type { SyncJournal } from './ShotgridSyncJournal';

/**
 * Import du référentiel de statuts ShotGrid.
 *
 * Deux sources sont nécessaires et ni l'une ni l'autre ne suffit : l'entité `Status`
 * du site donne l'apparence (nom complet, couleur, ordre) de tous les statuts
 * existants ; le schéma de `sg_status_list` dit lesquels sont réellement proposés sur
 * Shot, Task ou Version. Importer sans le schéma remplirait ReView de statuts qu'un
 * artiste ne verra jamais ; importer sans l'entité Status donnerait des codes nus.
 */

export interface SgStatusInfo {
  code: string;
  name: string;
  color: string;
  order: number;
}

/** Statuts du site, indexés par code. */
export async function fetchSiteStatuses(client: ShotgridClient): Promise<Map<string, SgStatusInfo>> {
  const records = await client.search('Status', {
    fields: ['code', 'name', 'bg_color', 'list_order'],
    maxRecords: 500,
  });
  const out = new Map<string, SgStatusInfo>();
  for (const r of records) {
    const code = asString(r.code);
    if (!code) continue;
    out.set(code, {
      code,
      name: asString(r.name) ?? code,
      color: rgbToHex(r.bg_color),
      order: asNumber(r.list_order) ?? 0,
    });
  }
  return out;
}

/** Codes réellement proposés pour `sg_status_list` sur une entité donnée. */
export async function fetchValidStatusCodes(client: ShotgridClient, entity: string): Promise<string[]> {
  const field = await client.schemaField(entity, 'sg_status_list');
  if (!field) return [];
  const properties = field.properties as Record<string, { value?: unknown }> | undefined;
  const valid = properties?.valid_values?.value;
  return Array.isArray(valid) ? valid.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Met à jour le référentiel `PipelineStatus` d'un scope (task ou shot).
 *
 * Les statuts existants sont mis à jour, les nouveaux créés ; aucun n'est supprimé —
 * une tâche ReView peut encore porter un statut retiré du site, et lui faire perdre
 * son statut serait pire que de garder une entrée obsolète.
 */
export async function syncPipelineStatuses(
  client: ShotgridClient,
  scope: 'task' | 'shot' | 'sequence',
  siteStatuses: Map<string, SgStatusInfo>,
  journal?: SyncJournal,
): Promise<Map<string, PipelineStatus>> {
  // Chaque entité a SA liste : quatre statuts sur une sequence, quinze sur un shot.
  // Les confondre proposerait des états que le site refuserait à l'écriture.
  const entity = scope === 'task' ? 'Task' : scope === 'shot' ? 'Shot' : 'Sequence';
  const codes = await fetchValidStatusCodes(client, entity);
  const out = new Map<string, PipelineStatus>();

  if (codes.length === 0) {
    await journal?.log('warn', 'shotgrid.log.noStatusSchema', { entity });
    const existing = await prisma.pipelineStatus.findMany({ where: { scope } });
    return new Map(existing.map((s) => [s.code, s]));
  }

  for (const [index, code] of codes.entries()) {
    const info = siteStatuses.get(code) ?? {
      code,
      name: code.toUpperCase(),
      color: '#6B7280',
      order: index,
    };
    const existing = await prisma.pipelineStatus.findUnique({
      where: { scope_code: { scope, code } },
    });
    const data = {
      name: info.name,
      color: info.color,
      order: info.order || index,
      isDone: sgStatusIsDone(code),
      isInactive: sgStatusIsInactive(code),
      // Ce statut vient du site : il ne sera proposé que sur les projets qui y sont
      // reliés. Le poser ici évite d'avoir à deviner l'origine après coup.
      origin: 'shotgrid',
      legacyStatus: sgStatusToEnum(code),
    };
    const status = existing
      ? await prisma.pipelineStatus.update({ where: { id: existing.id }, data })
      : await prisma.pipelineStatus.create({
          data: { scope, code, ...data, isDefault: index === 0 && scope === 'shot' },
        });
    out.set(code, status);
    journal?.count(`statuses.${scope}`, existing ? 'updated' : 'created');
  }

  // Statuts locaux absents du site : conservés, mais signalés une fois.
  const orphans = await prisma.pipelineStatus.findMany({
    where: { scope, code: { notIn: codes } },
  });
  for (const orphan of orphans) {
    out.set(orphan.code, orphan);
    await journal?.log('info', 'shotgrid.log.statusNotOnSite', { code: orphan.code, scope });
  }
  return out;
}

/**
 * Statuts de Version → `ReviewStatus` de ReView.
 *
 * Les décisions de review existent déjà côté ReView avec leur propre référentiel :
 * on ne le remplace pas, on complète ce qui manque et on renvoie la correspondance
 * code ShotGrid → identifiant local, que les réglages de la connexion mémorisent.
 */
export async function syncVersionStatuses(
  client: ShotgridClient,
  siteStatuses: Map<string, SgStatusInfo>,
  existingMap: Record<string, number>,
  journal?: SyncJournal,
): Promise<Record<string, number>> {
  const codes = await fetchValidStatusCodes(client, 'Version');
  if (codes.length === 0) {
    await journal?.log('warn', 'shotgrid.log.noStatusSchema', { entity: 'Version' });
    return existingMap;
  }

  const all = await prisma.reviewStatus.findMany();
  const byName = new Map(all.map((s) => [s.name.toLocaleLowerCase(), s]));
  const byId = new Map(all.map((s) => [s.id, s]));
  const map: Record<string, number> = {};

  for (const [index, code] of codes.entries()) {
    // Une correspondance déjà réglée à la main prime sur toute déduction.
    const configured = existingMap[code];
    if (configured && byId.has(configured)) {
      map[code] = configured;
      continue;
    }
    const info = siteStatuses.get(code) ?? { code, name: code.toUpperCase(), color: '#6B7280', order: index };
    const sameName = byName.get(info.name.toLocaleLowerCase());
    if (sameName) {
      map[code] = sameName.id;
      continue;
    }
    const created: ReviewStatus = await prisma.reviewStatus.create({
      data: {
        name: info.name,
        color: info.color,
        order: info.order || index,
        isApproval: sgStatusIsApproval(code),
        isRetake: sgStatusIsRetake(code),
      },
    });
    byName.set(created.name.toLocaleLowerCase(), created);
    map[code] = created.id;
    journal?.count('statuses.version', 'created');
    await journal?.log('info', 'shotgrid.log.reviewStatusCreated', { code, name: created.name });
  }
  return map;
}

/** Correspondance inverse (identifiant ReviewStatus → code ShotGrid) pour l'écriture. */
export function inverseVersionStatusMap(map: Record<string, number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [code, id] of Object.entries(map)) if (!out.has(id)) out.set(id, code);
  return out;
}

/** Statuts d'un scope, indexés par code — utilisé par le moteur de synchronisation. */
export async function loadPipelineStatuses(
  scope: 'task' | 'shot' | 'sequence',
): Promise<Map<string, PipelineStatus>> {
  const list = await prisma.pipelineStatus.findMany({ where: { scope } });
  return new Map(list.map((s) => [s.code, s]));
}
