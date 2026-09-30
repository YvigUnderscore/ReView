// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';

/**
 * Depuis quand une entité a bougé — la sienne ET celle de sa descendance.
 *
 * **Le piège.** `Shot.updatedAt` et `Sequence.updatedAt` ne bougent pas quand un média
 * descendant est publié : publier écrit sur la version et sur le média, jamais sur le plan
 * qui les porte. Une lueur « non consulté » fondée sur le seul `updatedAt` du plan ne
 * s'allumerait donc jamais là où ça compte — précisément sur la livraison qu'on attend.
 *
 * **Pourquoi calculer plutôt que propager.** Une colonne `lastActivityAt` tenue à jour à
 * l'écriture aurait été moins chère à lire, mais il aurait fallu l'écrire depuis chaque
 * chemin qui compte comme activité : publication, décision de review, dépôt de média,
 * changement de statut de tâche, renommage… Un chemin oublié ne se voit pas — la carte
 * reste éteinte et personne ne sait pourquoi. Un calcul, lui, se relit et se teste. Le
 * coût est celui, déjà accepté sur ces mêmes listes, de `awaitingReviewByShot` : des
 * agrégats groupés, un par niveau, pour la page entière.
 *
 * **Forme des requêtes.** Jamais de jointure par carte, jamais de sous-requête corrélée,
 * et jamais deux niveaux de descendance dans un même `JOIN` : trente plans × cinq tâches
 * × dix versions × deux médias, c'est trois mille lignes à agréger par séquence. Chaque
 * niveau est donc un agrégat plat et indépendant, tous lancés ensemble, fusionnés ici en
 * gardant la date la plus récente. Mesuré sur un projet de quarante mille médias, c'est
 * ce qui sépare une liste qui répond d'une liste qui s'écroule.
 */

/** Une entité telle que la liste l'a déjà lue : son id, et sa propre date de modification. */
export interface FreshnessRow {
  id: number;
  updatedAt: Date;
}

/** Ligne d'agrégat : la date la plus récente trouvée sous une entité (ou rien). */
interface LatestRow {
  id: number;
  at: Date | null;
}

/**
 * Fusionne les agrégats : la date de l'entité elle-même, relevée par celles de sa
 * descendance quand elles sont plus récentes.
 */
export function mergeLatest(seed: FreshnessRow[], aggregates: LatestRow[][]): Map<number, Date> {
  const out = new Map<number, Date>(seed.map((r) => [r.id, r.updatedAt]));
  for (const rows of aggregates) {
    for (const row of rows) {
      if (!row.at) continue;
      const known = out.get(row.id);
      // `!known` n'arrive pas en pratique (l'agrégat est borné aux ids semés) mais garde
      // la fonction totale : une ligne inattendue ne doit pas disparaître en silence.
      if (!known || row.at > known) out.set(row.id, row.at);
    }
  }
  return out;
}

/**
 * Non consulté = jamais ouvert, ou ouvert avant la dernière activité.
 *
 * La comparaison est stricte : ouvrir une entité écrit la visite **après** l'activité,
 * donc `visite > activité` et la lueur s'éteint. À égalité parfaite (même milliseconde),
 * on considère l'entité vue — c'est le cas d'une visite écrite dans la foulée d'une
 * modification faite par la même personne, qui n'a rien à se signaler à elle-même.
 */
export function unseenFrom(activity: Map<number, Date>, visits: Map<number, Date>): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const [id, at] of activity) {
    const seen = visits.get(id);
    out.set(id, !seen || at > seen);
  }
  return out;
}

/**
 * Activité d'un plan : la sienne, celle de ses tâches, de ses livraisons et de leurs médias.
 *
 * Les tâches comptent : changer le statut d'une tâche est le geste le plus fréquent de la
 * production, et il n'écrit rien sur le plan.
 */
export async function activityByShot(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "shotId" AS "id", MAX("updatedAt") AS "at"
      FROM "Task"
      WHERE "shotId" = ANY(${ids})
      GROUP BY "shotId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT t."shotId" AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      JOIN "Task" t ON t.id = v."taskId"
      WHERE t."shotId" = ANY(${ids}) AND v."deletedAt" IS NULL
      GROUP BY t."shotId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT t."shotId" AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      JOIN "Task" t ON t.id = v."taskId"
      WHERE t."shotId" = ANY(${ids}) AND m."deletedAt" IS NULL AND v."deletedAt" IS NULL
      GROUP BY t."shotId"
    `,
  ]);
  return mergeLatest(rows, [tasks, versions, medias]);
}

/**
 * Activité d'une séquence : la sienne et celle de ses plans, jusqu'aux médias.
 *
 * Les plans masqués ou en corbeille sont écartés, comme partout ailleurs : une séquence ne
 * doit pas s'allumer pour un plan que personne ne voit plus.
 */
export async function activityBySequence(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [shots, tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "sequenceId" AS "id", MAX("updatedAt") AS "at"
      FROM "Shot"
      WHERE "sequenceId" = ANY(${ids}) AND "deletedAt" IS NULL AND "hiddenAt" IS NULL
      GROUP BY "sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(t."updatedAt") AS "at"
      FROM "Task" t
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids}) AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL
      GROUP BY s."sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      JOIN "Task" t ON t.id = v."taskId"
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids})
        AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL AND v."deletedAt" IS NULL
      GROUP BY s."sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      JOIN "Task" t ON t.id = v."taskId"
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids})
        AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL
        AND v."deletedAt" IS NULL AND m."deletedAt" IS NULL
      GROUP BY s."sequenceId"
    `,
  ]);
  return mergeLatest(rows, [shots, tasks, versions, medias]);
}

/**
 * Activité d'un asset — deux chemins de rattachement.
 *
 * Une version pend d'une tâche de l'asset **ou** de l'asset lui-même (`Version` porte un
 * XOR de parent, cf. `awaitingReviewByAsset`). N'en suivre qu'un laisserait la moitié des
 * livraisons hors du calcul selon la façon dont le studio publie.
 */
export async function activityByAsset(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "assetId" AS "id", MAX("updatedAt") AS "at"
      FROM "Task"
      WHERE "assetId" = ANY(${ids})
      GROUP BY "assetId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT COALESCE(v."assetId", t."assetId") AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      LEFT JOIN "Task" t ON t.id = v."taskId"
      WHERE COALESCE(v."assetId", t."assetId") = ANY(${ids}) AND v."deletedAt" IS NULL
      GROUP BY 1
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT COALESCE(v."assetId", t."assetId") AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      LEFT JOIN "Task" t ON t.id = v."taskId"
      WHERE COALESCE(v."assetId", t."assetId") = ANY(${ids})
        AND v."deletedAt" IS NULL AND m."deletedAt" IS NULL
      GROUP BY 1
    `,
  ]);
  return mergeLatest(rows, [tasks, versions, medias]);
}
