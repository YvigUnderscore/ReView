// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { ShotgridConnection, ShotgridSite } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ShotgridClient, ShotgridApiError, clearTokenCache } from './ShotgridClient';
import { asString } from './shotgridMapper';
import { projectNameMatches } from './shotgridProjectGuard';
import { assertSafeBaseUrl, parseSettings, type ShotgridSettings } from './shotgridSettings';

/**
 * Configuration des sites ShotGrid et des connexions projet.
 *
 * Un site porte les identifiants (partagés par tous les projets du studio) ; une
 * connexion relie UN projet ReView à UN projet ShotGrid. Le nom du projet distant est
 * enregistré à la connexion et revérifié avant chaque synchronisation : c'est ce
 * contrôle qui empêche d'écrire dans le projet voisin si un identifiant change de main.
 */

export interface SiteInput {
  name: string;
  baseUrl: string;
  authMode: 'script' | 'user';
  scriptName?: string | null;
  scriptKey?: string | null;
  login?: string | null;
  password?: string | null;
}

/** Vue d'un site sans aucun secret — c'est elle qui sort de l'API. */
export function siteView(site: ShotgridSite) {
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    authMode: site.authMode,
    scriptName: site.scriptName,
    login: site.login,
    hasCredentials: Boolean(site.scriptKey ?? site.password),
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

export async function listSites() {
  const sites = await prisma.shotgridSite.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { connections: true } } },
  });
  return sites.map((s) => ({ ...siteView(s), connectionCount: s._count.connections }));
}

export async function createSite(input: SiteInput) {
  const baseUrl = assertSafeBaseUrl(input.baseUrl);
  assertCredentials(input);
  const existing = await prisma.shotgridSite.findUnique({ where: { baseUrl } });
  if (existing) throw conflict('Ce site ShotGrid est déjà enregistré');
  const site = await prisma.shotgridSite.create({
    data: {
      name: input.name,
      baseUrl,
      authMode: input.authMode,
      scriptName: input.scriptName ?? null,
      scriptKey: input.scriptKey ? encryptSecret(input.scriptKey) : null,
      login: input.login ?? null,
      password: input.password ? encryptSecret(input.password) : null,
    },
  });
  return siteView(site);
}

export async function updateSite(id: number, input: Partial<SiteInput>) {
  const site = await prisma.shotgridSite.findUnique({ where: { id } });
  if (!site) throw notFound('Site ShotGrid introuvable');
  const baseUrl = input.baseUrl ? assertSafeBaseUrl(input.baseUrl) : undefined;
  const updated = await prisma.shotgridSite.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
      ...(input.scriptName !== undefined ? { scriptName: input.scriptName } : {}),
      // Une chaîne vide veut dire « efface » ; l'absence de champ veut dire « ne touche pas ».
      ...(input.scriptKey !== undefined
        ? { scriptKey: input.scriptKey ? encryptSecret(input.scriptKey) : null }
        : {}),
      ...(input.login !== undefined ? { login: input.login } : {}),
      ...(input.password !== undefined
        ? { password: input.password ? encryptSecret(input.password) : null }
        : {}),
    },
  });
  clearTokenCache(site.baseUrl);
  clearTokenCache(updated.baseUrl);
  return siteView(updated);
}

export async function deleteSite(id: number) {
  const count = await prisma.shotgridConnection.count({ where: { siteId: id } });
  if (count > 0) throw conflict('Ce site porte encore des connexions de projet — les retirer d’abord');
  const site = await prisma.shotgridSite.findUnique({ where: { id } });
  if (site) clearTokenCache(site.baseUrl);
  await prisma.shotgridSite.delete({ where: { id } });
}

function assertCredentials(input: Partial<SiteInput>) {
  if (input.authMode === 'script' && !(input.scriptName && input.scriptKey))
    throw badRequest('Nom et clé du script ShotGrid requis');
  if (input.authMode === 'user' && !(input.login && input.password))
    throw badRequest('Identifiant et mot de passe legacy ShotGrid requis');
}

/** Client prêt à l'emploi pour un site (secrets déchiffrés au dernier moment). */
export async function clientForSite(siteId: number): Promise<ShotgridClient> {
  const site = await prisma.shotgridSite.findUnique({ where: { id: siteId } });
  if (!site) throw notFound('Site ShotGrid introuvable');
  return clientForSiteRecord(site);
}

export function clientForSiteRecord(site: ShotgridSite): ShotgridClient {
  return new ShotgridClient({
    baseUrl: site.baseUrl,
    authMode: site.authMode === 'user' ? 'user' : 'script',
    scriptName: site.scriptName,
    scriptKey: site.scriptKey ? decryptSecret(site.scriptKey) : null,
    login: site.login,
    password: site.password ? decryptSecret(site.password) : null,
  });
}

/** Test de connexion : authentification réelle + nombre de projets visibles. */
export async function testSite(siteId: number) {
  const client = await clientForSite(siteId);
  const info = await client.serverInfo();
  const projects = await client.search('Project', {
    fields: ['name', 'sg_status', 'archived'],
    sort: 'name',
    maxRecords: 500,
  });
  return {
    ok: true,
    version: asString(info.shotgun_version) ?? asString(info.api_version) ?? 'inconnue',
    projectCount: projects.length,
  };
}

/** Projets du site, pour que l'utilisateur choisisse le bon par son nom. */
export async function listRemoteProjects(siteId: number, query?: string) {
  const client = await clientForSite(siteId);
  const projects = await client.search('Project', {
    fields: ['name', 'sg_status', 'archived'],
    sort: 'name',
    maxRecords: 1000,
  });
  const q = (query ?? '').trim().toLocaleLowerCase();
  return projects
    .filter((p) => !q || (asString(p.name) ?? '').toLocaleLowerCase().includes(q))
    .map((p) => ({
      id: p.id,
      name: asString(p.name) ?? `Project ${p.id}`,
      status: asString(p.sg_status),
      archived: p.archived === true,
    }));
}

export interface ConnectionInput {
  siteId: number;
  sgProjectId: number;
  /**
   * Nom attendu du projet ShotGrid. Fourni par le client (celui qu'a vu l'utilisateur)
   * et confronté au nom réel avant l'enregistrement : si les deux divergent, l'écran
   * affichait autre chose que ce que l'identifiant désigne, et on refuse.
   */
  sgProjectName: string;
}

/**
 * Relie un projet ReView à un projet ShotGrid.
 *
 * La double vérification (identifiant ET nom) n'est pas de la ceinture-bretelles
 * gratuite : c'est le seul moment où un humain confirme la cible, et tout le reste
 * de l'intégration écrira dans ce projet sans lui redemander.
 */
export async function createConnection(projectId: number, input: ConnectionInput) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Projet introuvable');
  const existing = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (existing) throw conflict('Ce projet est déjà relié à ShotGrid');

  const client = await clientForSite(input.siteId);
  const remote = await client.findById('Project', input.sgProjectId, ['name', 'sg_status', 'archived']);
  if (!remote) throw badRequest("Ce projet n'existe pas sur le site ShotGrid");
  const remoteName = asString(remote.name);
  if (!projectNameMatches(remoteName, input.sgProjectName))
    throw badRequest(
      `Le projet ShotGrid #${input.sgProjectId} s'appelle « ${remoteName ?? '?'} », pas « ${input.sgProjectName} » — connexion refusée`,
    );

  const duplicate = await prisma.shotgridConnection.findUnique({
    where: { siteId_sgProjectId: { siteId: input.siteId, sgProjectId: input.sgProjectId } },
  });
  if (duplicate) throw conflict('Ce projet ShotGrid est déjà relié à un autre projet ReView');

  const connection = await prisma.shotgridConnection.create({
    data: {
      siteId: input.siteId,
      projectId,
      sgProjectId: input.sgProjectId,
      sgProjectName: remoteName ?? input.sgProjectName,
      webhookToken: randomBytes(24).toString('base64url'),
      webhookSecret: encryptSecret(randomBytes(24).toString('base64url')),
      settings: {},
    },
    include: { site: true },
  });
  logger.info(
    { projectId, sgProjectId: input.sgProjectId, sgProjectName: connection.sgProjectName },
    'Connexion ShotGrid créée',
  );
  return connection;
}

export async function getConnection(projectId: number) {
  return prisma.shotgridConnection.findUnique({
    where: { projectId },
    include: { site: true },
  });
}

export async function getConnectionOrThrow(projectId: number) {
  const conn = await getConnection(projectId);
  if (!conn) throw notFound('Ce projet n’est pas relié à ShotGrid');
  return conn;
}

export async function updateConnection(
  projectId: number,
  patch: { settings?: unknown; active?: boolean; webhookSecret?: string | null },
) {
  const conn = await getConnectionOrThrow(projectId);
  const settings =
    patch.settings !== undefined ? (parseSettings(patch.settings) as unknown as object) : undefined;
  return prisma.shotgridConnection.update({
    where: { id: conn.id },
    data: {
      ...(settings !== undefined ? { settings: settings as never } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.webhookSecret !== undefined
        ? { webhookSecret: patch.webhookSecret ? encryptSecret(patch.webhookSecret) : null }
        : {}),
    },
    include: { site: true },
  });
}

export async function deleteConnection(projectId: number) {
  const conn = await getConnectionOrThrow(projectId);
  await prisma.shotgridConnection.delete({ where: { id: conn.id } });
  logger.info({ projectId, sgProjectId: conn.sgProjectId }, 'Connexion ShotGrid retirée');
}

/** Régénère le jeton d'URL du webhook (rotation après fuite d'une URL). */
export async function rotateWebhookToken(projectId: number) {
  const conn = await getConnectionOrThrow(projectId);
  return prisma.shotgridConnection.update({
    where: { id: conn.id },
    data: { webhookToken: randomBytes(24).toString('base64url') },
    include: { site: true },
  });
}

export function webhookSecretOf(conn: ShotgridConnection): string | null {
  return conn.webhookSecret ? decryptSecret(conn.webhookSecret) : null;
}

export interface ConnectionContext {
  connection: ShotgridConnection & { site: ShotgridSite };
  client: ShotgridClient;
  settings: ShotgridSettings;
}

/**
 * Contexte de travail d'une connexion, avec la vérification d'identité du projet.
 *
 * Toute opération de synchronisation démarre ici. Si le projet distant a disparu ou
 * changé de nom, la connexion bascule en `project_mismatch` et l'opération s'arrête :
 * mieux vaut une synchronisation en panne, visible et réparable, qu'une écriture
 * silencieuse dans un projet qui n'est pas le bon.
 */
export async function openConnection(
  projectId: number,
  options: { verifyProject?: boolean } = {},
): Promise<ConnectionContext> {
  const connection = await getConnectionOrThrow(projectId);
  const client = clientForSiteRecord(connection.site);
  const settings = parseSettings(connection.settings);

  if (options.verifyProject !== false) {
    try {
      const remote = await client.findById('Project', connection.sgProjectId, ['name']);
      const remoteName = asString(remote?.name);
      if (!remote) {
        await markStatus(
          connection.id,
          'project_mismatch',
          `Projet ShotGrid #${connection.sgProjectId} introuvable`,
        );
        throw badRequest(`Le projet ShotGrid #${connection.sgProjectId} est introuvable`);
      }
      if (!projectNameMatches(remoteName, connection.sgProjectName)) {
        await markStatus(
          connection.id,
          'project_mismatch',
          `Le projet #${connection.sgProjectId} s'appelle désormais « ${remoteName ?? '?'} » (attendu « ${connection.sgProjectName} »)`,
        );
        throw badRequest(
          `Nom du projet ShotGrid modifié (« ${remoteName ?? '?'} » au lieu de « ${connection.sgProjectName} ») — synchronisation interrompue par sécurité`,
        );
      }
      if (connection.status === 'auth_error' || connection.status === 'project_mismatch')
        await markStatus(connection.id, 'ok', null);
    } catch (err) {
      if (err instanceof ShotgridApiError && err.isAuth) {
        await markStatus(connection.id, 'auth_error', err.message);
      }
      throw err;
    }
  }

  return { connection, client, settings };
}

export async function markStatus(id: number, status: string, message: string | null) {
  await prisma.shotgridConnection.update({
    where: { id },
    data: { status, statusMessage: message },
  });
}

/** Vue d'une connexion pour l'API (aucun secret, URL de webhook complète). */
export function connectionView(
  conn: ShotgridConnection & { site: ShotgridSite },
  appUrl: string | undefined,
) {
  const settings = parseSettings(conn.settings);
  return {
    id: conn.id,
    projectId: conn.projectId,
    site: siteView(conn.site),
    sgProjectId: conn.sgProjectId,
    sgProjectName: conn.sgProjectName,
    sgProjectUrl: `${conn.site.baseUrl}/detail/Project/${conn.sgProjectId}`,
    active: conn.active,
    status: conn.status,
    statusMessage: conn.statusMessage,
    settings,
    lastSyncAt: conn.lastSyncAt,
    lastEventAt: conn.lastEventAt,
    webhookUrl: `${(appUrl ?? '').replace(/\/$/, '')}/api/shotgrid/webhook/${conn.webhookToken}`,
    hasWebhookSecret: Boolean(conn.webhookSecret),
    createdAt: conn.createdAt,
  };
}
