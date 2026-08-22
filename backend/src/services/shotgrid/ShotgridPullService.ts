// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { ConnectionContext } from './ShotgridConfigService';
import { belongsToProject, projectFilter, type ProjectScope } from './shotgridProjectGuard';
import {
  asDate,
  asEntityRef,
  asEntityRefs,
  asNumber,
  asString,
  cutDuration,
  disambiguatedName,
  sgAssetType,
  sgDisplayName,
  sgStepToTaskType,
  type SgRecord,
} from './shotgridMapper';
import {
  findByLocal,
  findBySg,
  mapSgToLocal,
  removeLink,
  upsertLink,
  type LocalType,
  type AssetLinkData,
  type ShotLinkData,
  type TaskLinkData,
} from './shotgridLinks';
import type { SyncJournal } from './ShotgridSyncJournal';
import { can } from './shotgridSettings';
import { enqueuePush } from './ShotgridPushService';
import { emitToProject } from '../SocketService';
import { isReplayable, TOUCHED_EVENT_NAME, type TouchedEntities, type TouchedKind } from './ShotgridTouched';
import { resolveForTask, type TaskDepartment } from '../DepartmentService';

/**
 * Import de la hiérarchie de production depuis ShotGrid.
 *
 * Chaque requête porte le filtre de projet ET chaque entité reçue est revérifiée :
 * ShotGrid héberge tous les projets du studio sur le même site, et un filtre oublié
 * ne se voit pas — il importe simplement le projet du voisin par-dessus le nôtre.
 *
 * L'import est idempotent : re-synchroniser un projet inchangé ne produit aucune
 * écriture. C'est ce qui rend la réconciliation périodique sans risque.
 */

const SEQUENCE_FIELDS = ['code', 'description', 'sg_status_list', 'project', 'updated_at'];
const SHOT_FIELDS = [
  'code',
  'description',
  'sg_sequence',
  'sg_cut_in',
  'sg_cut_out',
  'sg_cut_duration',
  'sg_status_list',
  'project',
  'updated_at',
];
const ASSET_FIELDS = [
  'code',
  'description',
  'sg_asset_type',
  'sg_status_list',
  // Rattachements portés par l'asset côté ShotGrid : c'est de là que sortent les
  // listes « quels assets pour ce plan », et les lire évite de les ressaisir ici.
  'shots',
  'sequences',
  'project',
  'updated_at',
];
const TASK_FIELDS = [
  'content',
  'step',
  'entity',
  'sg_status_list',
  'start_date',
  'due_date',
  'duration',
  'task_assignees',
  'project',
  'updated_at',
];

export interface PullOptions {
  /** Ne reprendre que ce qui a changé depuis cette date (réconciliation, incrémental). */
  since?: Date | null;
  /** Restreindre à quelques entités distantes (traitement d'un événement). */
  onlySgIds?: { sgType: string; sgId: number }[];
}

interface PullContext extends ConnectionContext {
  journal: SyncJournal;
  scope: ProjectScope;
  /**
   * Accumulateur des entités réalignées. Absent, chaque entité émet son événement tout
   * de suite — c'est le comportement attendu des appelants qui n'orchestrent qu'une
   * passe isolée (import manuel de versions).
   */
  touched?: TouchedEntities;
}

/**
 * Signale qu'une entité vient d'être réalignée.
 *
 * Avec collecteur, l'entité est retenue et la décision d'émettre est prise en fin de
 * passe (voir `ShotgridTouched`). Sans collecteur, on émet comme avant : un appelant
 * isolé n'a personne pour vider l'accumulateur derrière lui. Les familles sans événement
 * fin côté client (notes, playlists) ne comptent alors pour rien — elles n'ont jamais
 * rien émis.
 */
export function touch(
  ctx: PullContext,
  kind: TouchedKind,
  id: number,
  extra?: Record<string, unknown>,
): void {
  if (ctx.touched) {
    ctx.touched.add(kind, id, extra);
    return;
  }
  if (!isReplayable(kind)) return;
  emitToProject(ctx.connection.projectId, TOUCHED_EVENT_NAME[kind], {
    projectId: ctx.connection.projectId,
    id,
    ...extra,
  });
}

/** Filtres d'une recherche : projet obligatoire, plus la fenêtre temporelle éventuelle. */
function buildFilters(scope: ProjectScope, since?: Date | null): Array<[string, string, unknown]> {
  const filters: Array<[string, string, unknown]> = [projectFilter(scope.sgProjectId)];
  if (since) filters.push(['updated_at', 'greater_than', since.toISOString()]);
  return filters;
}

/**
 * Écarte toute entité qui n'appartient pas au projet lié.
 *
 * Ce contrôle ne devrait jamais rien attraper puisque les requêtes sont filtrées —
 * c'est précisément pourquoi il est là : le jour où un filtre saute, on refuse
 * l'entité au lieu d'écraser le travail d'un autre projet, et on le dit fort.
 */
async function keepInProject(records: SgRecord[], ctx: PullContext): Promise<SgRecord[]> {
  const kept: SgRecord[] = [];
  for (const record of records) {
    const verdict = belongsToProject(record, ctx.scope);
    if (verdict.ok) {
      kept.push(record);
      continue;
    }
    ctx.journal.count('guard', 'skipped');
    await ctx.journal.log(
      'error',
      'shotgrid.log.wrongProject',
      {
        sgType: record.type,
        sgId: record.id,
        expected: ctx.scope.sgProjectId,
        found: verdict.foundProjectId ?? null,
      },
      { sgType: record.type, sgId: record.id },
    );
    logger.error(
      {
        sgType: record.type,
        sgId: record.id,
        expected: ctx.scope.sgProjectId,
        found: verdict.foundProjectId,
      },
      'Entité ShotGrid hors du projet lié — écartée',
    );
  }
  return kept;
}

/** Lecture d'un lot d'entités, filtrée et vérifiée. */
async function fetchScoped(
  ctx: PullContext,
  entity: string,
  fields: string[],
  options: PullOptions,
): Promise<SgRecord[]> {
  if (options.onlySgIds?.length) {
    const ids = options.onlySgIds.filter((r) => r.sgType === entity).map((r) => r.sgId);
    if (ids.length === 0) return [];
    const records: SgRecord[] = [];
    for (const id of ids) {
      const rec = await ctx.client.findById(entity, id, fields);
      if (rec) records.push(rec);
    }
    return keepInProject(records, ctx);
  }
  const records = await ctx.client.search(entity, {
    fields,
    filters: buildFilters(ctx.scope, options.since),
    sort: 'id',
  });
  return keepInProject(records, ctx);
}

/**
 * Une entité locale trouvée par son nom peut-elle accueillir cette entité ShotGrid ?
 *
 * Non si elle est déjà la contrepartie d'une autre : un site héberge sans peine quatre
 * séquences nommées « DO_NOT_USE_ », et les fondre sur la même ligne locale n'en
 * importerait qu'une — les trois autres manqueraient à chaque comparaison, sans que rien
 * ne dise pourquoi. Le nom sert donc à adopter ce qui existait avant la liaison, jamais
 * à confondre deux entités distinctes du site.
 */
async function adoptable(
  connectionId: number,
  localType: LocalType,
  localId: number,
  sgId: number,
): Promise<boolean> {
  const held = await findByLocal(connectionId, localType, localId);
  return !held || held.sgId === sgId;
}

/**
 * Où écrire cette entité du site, et sous quel nom.
 *
 * Trois questions dans l'ordre : a-t-elle déjà une contrepartie locale (le lien) ? sinon,
 * peut-elle adopter une entité de même nom créée avant la liaison ? et surtout : le nom
 * du site est-il libre au moment d'écrire ?
 *
 * Cette dernière question vaut aussi à la mise à jour, pas seulement à la création. La
 * poser trop tard coûte une violation de contrainte d'unicité : une entité déjà
 * désambiguïsée se ferait renommer vers le nom du site à la passe suivante — nom que sa
 * jumelle porte toujours.
 *
 * Les accès à la base sont injectés : cette résolution est une règle, et elle se teste
 * comme telle.
 */
export async function localTarget<T extends { id: number }>(params: {
  connectionId: number;
  localType: LocalType;
  sgId: number;
  /** Nom porté par l'entité côté ShotGrid. */
  sgName: string;
  linkedId: number | null;
  findById: (id: number) => Promise<T | null>;
  findByName: (name: string) => Promise<T | null>;
}): Promise<{ existing: T | null; name: string }> {
  const { connectionId, localType, sgId, sgName, linkedId } = params;
  let existing = linkedId !== null ? await params.findById(linkedId) : null;

  if (!existing) {
    const sameName = await params.findByName(sgName);
    if (sameName && (await adoptable(connectionId, localType, sameName.id, sgId))) existing = sameName;
    else if (sameName) existing = await params.findByName(disambiguatedName(sgName, sgId));
  }

  // Le nom du site s'il est libre ou déjà le nôtre ; sinon le nôtre, suffixé.
  const holder = await params.findByName(sgName);
  const name = !holder || holder.id === existing?.id ? sgName : disambiguatedName(sgName, sgId);
  return { existing, name };
}

/**
 * Y a-t-il vraiment conflit ? Deux conditions, et il faut les deux.
 *
 * Le côté ReView doit avoir bougé depuis la dernière synchronisation, **et** les deux
 * valeurs doivent réellement diverger. La seconde manquait : tout changement local
 * déclarait un conflit, y compris quand les deux côtés portaient déjà la même valeur.
 * Le journal du studio en était plein — « review: ip, shotgrid: ip » — et l'on ne
 * distinguait plus les vrais désaccords du bruit.
 *
 * Pire : `updatedAt` bouge pour n'importe quelle modification de la tâche (checklist,
 * assigné, dates). Cocher une case déclarait donc un conflit **de statut**.
 */
export function isRealConflict(params: {
  localUpdatedAt: Date | null | undefined;
  linkSyncedAt: Date | null | undefined;
  reviewValue?: string | null;
  remoteValue?: string | null;
}): boolean {
  const { localUpdatedAt, linkSyncedAt } = params;
  if (!localUpdatedAt || !linkSyncedAt) return false;
  // Une seconde de tolérance : l'écriture locale et l'horodatage du lien ne sont jamais
  // simultanés à la milliseconde près.
  if (localUpdatedAt.getTime() <= linkSyncedAt.getTime() + 1000) return false;
  // Valeurs connues et identiques : le site et ReView disent la même chose, il n'y a
  // rien à arbitrer. Valeurs inconnues (appelant qui n'en fournit pas) : on s'en tient
  // à la date, comme avant.
  if (params.reviewValue !== undefined && params.remoteValue !== undefined) {
    return (params.reviewValue ?? null) !== (params.remoteValue ?? null);
  }
  return true;
}

/**
 * Verdict d'arbitrage. `overwrite` : la valeur du site descend. `keep` : ReView garde la
 * sienne et la renvoie au site. `defer` : personne ne bouge, un humain tranchera.
 */
export type ConflictVerdict = 'overwrite' | 'keep' | 'defer';

/** Traduit le réglage du studio en verdict. Pure — c'est la règle, sans les effets. */
export function arbitrate(policy: string | undefined): ConflictVerdict {
  if (policy === 'review_wins') return 'keep';
  if (policy === 'manual') return 'defer';
  return 'overwrite';
}

/**
 * Retire du `data` le champ que l'arbitrage a laissé à ReView.
 *
 * On retire le champ, pas l'écriture : le nom, les dates et le rattachement ne sont pas
 * en conflit et doivent continuer à descendre du site.
 */
function withoutStatus<T extends Record<string, unknown>>(data: T, verdict: ConflictVerdict): T {
  if (verdict === 'overwrite') return data;
  const { pipelineStatusId: _p, status: _s, ...rest } = data;
  return rest as unknown as T;
}

/**
 * Arbitre un conflit et le journalise.
 *
 * Le réglage « Quand les deux côtés ont changé » proposait trois politiques et n'en
 * appliquait aucune : `conflictPolicy` n'était lu que comme variable d'un message, et
 * l'appelant écrivait la valeur du site quoi qu'il arrive. Un studio en `review_wins`
 * voyait donc ses décisions écrasées exactement comme en `sg_wins`, avec en prime une
 * ligne de journal affirmant le contraire.
 *
 * Renvoie le verdict ; c'est à l'appelant de retirer le champ litigieux de son `data`
 * (et lui seul : les autres champs, eux, ne sont pas en conflit et doivent descendre).
 */
async function arbitrateConflict(
  ctx: PullContext,
  params: {
    localUpdatedAt: Date | null | undefined;
    linkSyncedAt: Date | null | undefined;
    localType: string;
    localId: number;
    sgType: string;
    sgId: number;
    name: string;
    /**
     * Champ concerné et valeurs en présence — ce que l'arbitre doit voir.
     * `field` est un identifiant stable (`status`…), pas un libellé : c'est le lecteur
     * qui décide de la langue, pas le serveur qui a écrit la ligne.
     */
    field?: string;
    reviewValue?: string | null;
    remoteValue?: string | null;
  },
): Promise<ConflictVerdict> {
  const { localUpdatedAt } = params;
  if (!isRealConflict(params)) return 'overwrite';
  const verdict = arbitrate(ctx.settings.conflictPolicy);
  ctx.journal.count('conflicts', 'updated');
  // Une clé par issue : le message est écrit après l'arbitrage, pas avant. L'ancien
  // texte annonçait un écrasement en interpolant la politique — il pouvait donc dire
  // « review_wins » au moment même où il écrasait.
  const key =
    verdict === 'keep'
      ? 'shotgrid.log.conflictKept'
      : verdict === 'defer'
        ? 'shotgrid.log.conflictPending'
        : 'shotgrid.log.conflictOverwritten';
  await ctx.journal.conflict(
    key,
    {
      name: params.name,
      policy: ctx.settings.conflictPolicy,
      // Sans ces repères, la ligne de conflit ne dit pas ce qui a divergé ni quand :
      // impossible d'arbitrer en connaissance de cause.
      ...(params.field ? { field: params.field } : {}),
      review: params.reviewValue ?? '—',
      shotgrid: params.remoteValue ?? '—',
      // `isRealConflict` a déjà écarté le cas sans date : elle est forcément là.
      localAt: localUpdatedAt?.toISOString() ?? '—',
    },
    {
      sgType: params.sgType,
      sgId: params.sgId,
      localType: params.localType,
      localId: params.localId,
    },
  );
  return verdict;
}

/**
 * Traduit un `sg_status_list` en écriture Prisma — trois situations, trois réponses.
 *
 * Le code d'origine les confondait, et de deux façons opposées :
 * séquence et plan écrivaient `null` dès que la carte des statuts ne reconnaissait pas
 * le code (statut **effacé** en silence), tandis que la tâche omettait le champ même
 * quand le site avait vidé le statut (effacement **jamais propagé**). La carte est vide
 * dans des cas ordinaires — `statuses.read` fermé, schéma du site inaccessible, code
 * retiré des `valid_values` — donc une passe de routine suffisait à vider les statuts
 * d'un projet entier sans une ligne de journal.
 *
 * - code absent/vide  → `{ pipelineStatusId: null }` : le site a vidé, on propage.
 * - code connu        → on écrit le statut.
 * - code inconnu      → **rien** : on garde la valeur locale, et on le dit au journal.
 */
export function statusPatch(
  statusCode: string | null | undefined,
  statuses: Map<string, PipelineStatus>,
): { patch: { pipelineStatusId?: number | null }; unknownCode: string | null } {
  if (!statusCode) return { patch: { pipelineStatusId: null }, unknownCode: null };
  const status = statuses.get(statusCode);
  if (status) return { patch: { pipelineStatusId: status.id }, unknownCode: null };
  return { patch: {}, unknownCode: statusCode };
}

/**
 * Signale un code de statut inconnu — une seule fois par (portée, code) et par passe.
 * Une passe complète sur trois mille plans écrirait autrement trois mille lignes
 * identiques et noierait le journal.
 */
const reportedUnknownStatus = new WeakMap<SyncJournal, Set<string>>();

export async function noteUnknownStatus(
  ctx: PullContext,
  scope: string,
  code: string | null,
  name: string,
): Promise<void> {
  if (!code) return;
  let seen = reportedUnknownStatus.get(ctx.journal);
  if (!seen) {
    seen = new Set();
    reportedUnknownStatus.set(ctx.journal, seen);
  }
  const key = `${scope}:${code}`;
  if (seen.has(key)) return;
  seen.add(key);
  await ctx.journal.log('warn', 'shotgrid.log.unknownStatusCode', { code, scope, name });
}

// ───────────────────────────── Séquences ─────────────────────────────

export async function pullSequences(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus> = new Map(),
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Sequence', SEQUENCE_FIELDS, options);
  /**
   * `order` se déduit du rang dans le lot reçu. Il n'a donc de sens que si le lot est le
   * projet entier : sur une relecture ciblée (un webhook de statut) le lot fait un
   * élément, et l'entité repartait à `order: 0` — le changement de statut d'un plan
   * remontait la séquence en tête de liste pour tout le monde.
   */
  const fullPass = !options.since && !options.onlySgIds;
  // Passe complète : ce que le site ne renvoie plus a été mis à la corbeille là-bas.
  if (fullPass) await trashRemoved(ctx, 'Sequence', new Set(records.map((r) => r.id)));
  const links = await mapSgToLocal(ctx.connection.id, 'sequence');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SQ${record.id}`;
    const statusCode = asString(record.sg_status_list);
    const seqStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'sequence', seqStatus.unknownCode, code);
    const link = links.get(record.id);
    const { existing, name: localCode } = await localTarget({
      connectionId: ctx.connection.id,
      localType: 'sequence',
      sgId: record.id,
      sgName: code,
      linkedId: link?.localId ?? null,
      findById: (id) => prisma.sequence.findUnique({ where: { id } }),
      findByName: (c) =>
        prisma.sequence.findUnique({
          where: { projectId_code: { projectId: ctx.connection.projectId, code: c } },
        }),
    });

    const data = {
      name: localCode,
      code: localCode,
      ...(fullPass ? { order: index } : {}),
      projectId: ctx.connection.projectId,
      ...seqStatus.patch,
      deletedAt: null,
    };

    let saved: { id: number };
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      // La séquence n'était pas arbitrée du tout : elle était écrasée sans détection ni
      // trace, quelle que soit la politique du studio.
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'sequence',
        localId: existing.id,
        sgType: 'Sequence',
        sgId: record.id,
        name: localCode,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, {
          type: 'sequence-status',
          sequenceId: existing.id,
        });
      }
      saved = await prisma.sequence.update({
        where: { id: existing.id },
        data: withoutStatus(data, verdict),
      });
    } else {
      saved = await prisma.sequence.create({ data });
    }
    // Sans ce signal, un statut lu depuis le site n'atteint jamais un écran ouvert :
    // il fallait recharger la page pour le voir apparaître.
    touch(ctx, 'sequence', saved.id);

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'sequence',
      localId: saved.id,
      sgType: 'Sequence',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
    });
    ctx.journal.count('sequences', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Plans ─────────────────────────────

export async function pullShots(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Shot', SHOT_FIELDS, options);
  // Même raison que pour les séquences : `order` n'a de sens qu'en passe complète.
  const fullPass = !options.since && !options.onlySgIds;
  if (fullPass) await trashRemoved(ctx, 'Shot', new Set(records.map((r) => r.id)));
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SH${record.id}`;
    const sequenceRef = asEntityRef(record.sg_sequence);
    const sequenceId = sequenceRef ? (sequenceLinks.get(sequenceRef.id)?.localId ?? null) : null;
    const statusCode = asString(record.sg_status_list);
    const shotStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'shot', shotStatus.unknownCode, code);
    const cutIn = asNumber(record.sg_cut_in);
    const cutOut = asNumber(record.sg_cut_out);

    const link = shotLinks.get(record.id);
    const existing = link ? await prisma.shot.findUnique({ where: { id: link.localId } }) : null;

    const data = {
      projectId: ctx.connection.projectId,
      sequenceId,
      name: code,
      code,
      startFrame: cutIn,
      endFrame: cutOut,
      ...(fullPass ? { order: index } : {}),
      ...shotStatus.patch,
      deletedAt: null,
    };

    let savedId: number;
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'shot',
        localId: existing.id,
        sgType: 'Shot',
        sgId: record.id,
        name: code,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, { type: 'shot-status', shotId: existing.id });
      }
      const updated = await prisma.shot.update({
        where: { id: existing.id },
        data: withoutStatus(data, verdict),
      });
      savedId = updated.id;
      ctx.journal.count('shots', 'updated');
    } else {
      const created = await prisma.shot.create({ data });
      savedId = created.id;
      ctx.journal.count('shots', 'created');
    }
    touch(ctx, 'shot', savedId);

    const linkData: ShotLinkData = {
      sgStatusCode: statusCode,
      cutDuration: asNumber(record.sg_cut_duration) ?? cutDuration(cutIn, cutOut),
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'shot',
      localId: savedId,
      sgType: 'Shot',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
  }
}

// ───────────────────────────── Assets ─────────────────────────────

export async function pullAssets(ctx: PullContext, options: PullOptions = {}) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Asset', ASSET_FIELDS, options);
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Asset', new Set(records.map((r) => r.id)));
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  // Les plans et sequences ont été importés juste avant : leurs correspondances
  // existent, on peut donc rattacher sans rien créer au passage.
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');

  for (const record of records) {
    const name = asString(record.code) ?? `Asset ${record.id}`;
    const link = assetLinks.get(record.id);
    const { existing, name: localName } = await localTarget({
      connectionId: ctx.connection.id,
      localType: 'asset',
      sgId: record.id,
      sgName: name,
      linkedId: link?.localId ?? null,
      findById: (id) => prisma.asset.findUnique({ where: { id } }),
      findByName: (n) =>
        prisma.asset.findUnique({
          where: { projectId_name: { projectId: ctx.connection.projectId, name: n } },
        }),
    });

    const sgType = asString(record.sg_asset_type);
    const data = {
      projectId: ctx.connection.projectId,
      name: localName,
      // L'énumération sert aux filtres ; le libellé exact du studio est ce qui s'affiche.
      type: sgAssetType(sgType),
      typeLabel: sgType,
      description: asString(record.description),
      deletedAt: null,
    };
    const saved = existing
      ? await prisma.asset.update({ where: { id: existing.id }, data })
      : await prisma.asset.create({ data });

    // Rattachements : `set` remplace la liste entière plutôt que d'ajouter — c'est ce
    // qui empêche les doublons quand une synchronisation repasse. Seules les entités
    // déjà reliées sont citées : un shot inconnu de ReView n'a rien à rattacher.
    const shotIds = asEntityRefs(record.shots)
      .map((r) => shotLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');
    const sequenceIds = asEntityRefs(record.sequences)
      .map((r) => sequenceLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');
    await prisma.asset.update({
      where: { id: saved.id },
      data: {
        shots: { set: shotIds.map((id) => ({ id })) },
        sequences: { set: sequenceIds.map((id) => ({ id })) },
      },
    });

    const linkData: AssetLinkData = {
      sgAssetType: asString(record.sg_asset_type),
      sgStatusCode: asString(record.sg_status_list),
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'asset',
      localId: saved.id,
      sgType: 'Asset',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
    // L'asset n'émettait rien : un asset créé ou renommé depuis le site n'atteignait pas
    // un écran ouvert, alors même que le client sait traiter `asset:update`.
    touch(ctx, 'asset', saved.id);
    ctx.journal.count('assets', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Tâches ─────────────────────────────

/**
 * Correspondance des comptes par adresse électronique.
 *
 * Aucun compte n'est créé : un artiste ShotGrid sans compte ReView reste affiché par
 * son nom (conservé dans le lien) mais la tâche n'est assignée à personne. Inventer
 * des comptes depuis une synchronisation ouvrirait des accès que personne n'a validés.
 */
export async function buildUserMap(ctx: PullContext): Promise<Map<number, number>> {
  if (!can(ctx.settings, 'users', 'read')) return new Map();
  const sgUsers = await ctx.client.search('HumanUser', {
    fields: ['login', 'name', 'email', 'sg_status_list'],
    maxRecords: 2000,
  });
  const emails = sgUsers.map((u) => asString(u.email)).filter((e): e is string => Boolean(e));
  const locals = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true },
      })
    : [];
  const byEmail = new Map(locals.map((u) => [u.email.toLocaleLowerCase(), u.id]));

  const out = new Map<number, number>();
  for (const sgUser of sgUsers) {
    const email = asString(sgUser.email)?.toLocaleLowerCase();
    const localId = email ? byEmail.get(email) : undefined;
    if (localId) {
      out.set(sgUser.id, localId);
      await upsertLink({
        connectionId: ctx.connection.id,
        localType: 'user',
        localId,
        sgType: 'HumanUser',
        sgId: sgUser.id,
        data: { login: asString(sgUser.login), name: asString(sgUser.name), email },
      });
      ctx.journal.count('users', 'updated');
    } else {
      ctx.journal.count('users', 'skipped');
    }
  }
  return out;
}

/**
 * Résolution mémorisée des étapes en départements, le temps d'une passe.
 *
 * Un projet compte des milliers de tâches pour une dizaine d'étapes : sans mémoire, la
 * synchronisation ferait autant d'allers-retours en base qu'il y a de tâches, pour
 * retrouver chaque fois les mêmes dix lignes.
 */
export function departmentResolver(
  projectId: number,
): (stepName: string | null | undefined) => Promise<TaskDepartment> {
  const seen = new Map<string, TaskDepartment>();
  return async (stepName) => {
    const key = stepName?.trim();
    if (!key) return { department: null, departmentId: null };
    const cached = seen.get(key.toLowerCase());
    if (cached) return cached;
    const resolved = await resolveForTask(projectId, key);
    seen.set(key.toLowerCase(), resolved);
    return resolved;
  };
}

export async function pullTasks(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  userMap: Map<number, number>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'tasks', 'read')) return;
  const records = await fetchScoped(ctx, 'Task', TASK_FIELDS, options);
  // Passe complète : une tâche que le site ne renvoie plus y a été mise à la corbeille.
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Task', new Set(records.map((r) => r.id)));
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  const taskLinks = await mapSgToLocal(ctx.connection.id, 'task');
  const departmentOf = departmentResolver(ctx.connection.projectId);

  for (const record of records) {
    const name = asString(record.content) ?? sgDisplayName(record);
    const entityRef = asEntityRef(record.entity);
    const shotId = entityRef?.type === 'Shot' ? (shotLinks.get(entityRef.id)?.localId ?? null) : null;
    const assetId = entityRef?.type === 'Asset' ? (assetLinks.get(entityRef.id)?.localId ?? null) : null;

    if (!shotId && !assetId) {
      ctx.journal.count('tasks', 'skipped');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.taskWithoutParent',
        { name, entity: entityRef?.type ?? 'aucune' },
        { sgType: 'Task', sgId: record.id },
      );
      continue;
    }

    const stepRef = asEntityRef(record.step);
    const stepName = stepRef?.name ?? asString(record.step);
    const statusCode = asString(record.sg_status_list);
    const status = statusCode ? statuses.get(statusCode) : undefined;
    const taskStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'task', taskStatus.unknownCode, name);
    const assignees = asEntityRefs(record.task_assignees);
    const assigneeId =
      assignees.map((a) => userMap.get(a.id)).find((id): id is number => Boolean(id)) ?? null;

    const link = taskLinks.get(record.id);
    const existing = link ? await prisma.task.findUnique({ where: { id: link.localId } }) : null;

    // L'étape du site devient un département local, relation comprise : n'écrire que la
    // chaîne laissait `departmentId` vide sur TOUTES les tâches d'un projet piloté depuis
    // ShotGrid, et l'assignation par département — qui interroge la relation — refusait
    // des tâches qui existent.
    const department = await departmentOf(stepName);

    const data = {
      name,
      type: sgStepToTaskType(stepName),
      ...department,
      shotId,
      assetId: shotId ? null : assetId,
      assigneeId,
      startDate: asDate(record.start_date),
      dueDate: asDate(record.due_date),
      ...taskStatus.patch,
      // L'enum historique suit le statut de pipeline tant qu'elle existe (`legacyStatus`).
      ...(status?.legacyStatus ? { status: status.legacyStatus } : {}),
    };

    let savedId: number;
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'task',
        localId: existing.id,
        sgType: 'Task',
        sgId: record.id,
        name,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, { type: 'task-status', taskId: existing.id });
      }
      await prisma.task.update({ where: { id: existing.id }, data: withoutStatus(data, verdict) });
      savedId = existing.id;
      ctx.journal.count('tasks', 'updated');
    } else {
      const created = await prisma.task.create({ data });
      savedId = created.id;
      ctx.journal.count('tasks', 'created');
    }
    touch(ctx, 'task', savedId, { shotId: data.shotId ?? null, assetId: data.assetId ?? null });

    const linkData: TaskLinkData = {
      durationMinutes: asNumber(record.duration),
      stepName,
      sgStatusCode: statusCode,
      sgAssignees: assignees.map((a) => ({ id: a.id, name: a.name ?? `#${a.id}`, email: null })),
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'task',
      localId: savedId,
      sgType: 'Task',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
  }
}

/**
 * Entités retirées côté ShotGrid : mises à la corbeille, jamais supprimées.
 * Le travail associé (commentaires, versions, historique) reste consultable, et un
 * retrait par erreur côté ShotGrid se répare sans perte.
 */
export async function trashRemoved(
  ctx: PullContext,
  sgType: 'Shot' | 'Sequence' | 'Asset' | 'Task',
  aliveSgIds: Set<number>,
): Promise<void> {
  const localType = sgType.toLowerCase() as 'shot' | 'sequence' | 'asset' | 'task';
  const links = await mapSgToLocal(ctx.connection.id, localType);
  for (const [sgId, link] of links) {
    if (aliveSgIds.has(sgId)) continue;

    const table =
      sgType === 'Shot'
        ? prisma.shot
        : sgType === 'Sequence'
          ? prisma.sequence
          : sgType === 'Asset'
            ? prisma.asset
            : prisma.task;
    const target = (await (table as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
      where: { id: link.localId },
    })) as { id: number } | null;

    // Cible déjà disparue : le lien ne désigne plus rien. Le garder ferait rejouer ce
    // retrait — et son message — à chaque synchronisation, indéfiniment.
    if (!target) {
      await removeLink(ctx.connection.id, sgType, sgId);
      continue;
    }

    if (sgType === 'Task') {
      if (!(await retireTask(ctx, link.localId, sgId))) continue;
      // La task est partie pour de bon : plus rien à relier.
      await removeLink(ctx.connection.id, sgType, sgId);
    } else {
      // Le lien survit à la mise à la corbeille : restaurer côté ShotGrid doit rendre
      // l'entité telle qu'elle était, avec son historique, pas en fabriquer une copie.
      await (table as { update: (a: unknown) => Promise<unknown> })
        .update({ where: { id: link.localId }, data: { deletedAt: new Date() } })
        .catch(() => undefined);
    }
    ctx.journal.count(`${localType}s`, 'skipped');
    await ctx.journal.log(
      'info',
      'shotgrid.log.trashedRemotely',
      { sgType, sgId },
      { sgType, sgId, localType, localId: link.localId },
    );
  }
}

/**
 * Retrait d'une tâche mise à la corbeille côté ShotGrid.
 *
 * Une tâche n'a pas de suppression douce : la supprimer emporte ses versions en cascade,
 * donc le travail de review qui y est attaché. On ne retire donc que les tâches vides ;
 * une tâche qui porte des versions reste en place et le journal le dit, à charge d'un
 * humain de décider quoi faire de ce travail devenu orphelin.
 *
 * Renvoie `true` si la tâche a effectivement été retirée.
 */
async function retireTask(ctx: PullContext, localId: number, sgId: number): Promise<boolean> {
  const versions = await prisma.version.count({ where: { taskId: localId } });
  if (versions > 0) {
    await ctx.journal.log(
      'warn',
      'shotgrid.log.trashedTaskKept',
      { sgId, count: versions },
      { sgType: 'Task', sgId, localType: 'task', localId },
    );
    return false;
  }
  await prisma.task.delete({ where: { id: localId } }).catch(() => undefined);
  return true;
}

export async function existsRemotely(ctx: PullContext, sgType: string, sgId: number): Promise<boolean> {
  const record = await ctx.client.findById(sgType, sgId, ['id', 'project']);
  if (!record) return false;
  return belongsToProject(record, ctx.scope).ok;
}

export { findBySg };
export type { PullContext };
