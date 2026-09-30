// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, VisibilityRule } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import {
  MATCH_TYPES,
  VISIBILITY_TYPES,
  compileRule,
  coversType,
  matchCandidates,
  type MatchType,
  type VisibilityType,
} from '../lib/visibility';

/**
 * Masquage d'éléments (admin).
 *
 * Le masquage est **matérialisé**, pas évalué à la lecture : chaque entité couverte porte
 * `hiddenAt`, et toutes les listes filtrent sur cette seule colonne. C'est la seule façon
 * de tenir la promesse « masqué partout, sans oubli » — une évaluation d'expression à
 * chaque requête ne se pousse pas en SQL, fausserait tous les décomptes paginés, et aurait
 * laissé passer les écrans qu'on aurait oublié de convertir.
 *
 * Le recalcul est donc le point de passage obligé. Il tourne au changement d'une règle et
 * après chaque import ShotGrid — c'est là que naissent les éléments qu'on veut masquer.
 */

/** Les quatre tables qui portent un masquage, et le champ qui les identifie. */
const TABLES = {
  episode: 'episode',
  sequence: 'sequence',
  shot: 'shot',
  asset: 'asset',
} as const;

export interface RuleInput {
  projectId?: number | null;
  entityType: VisibilityType;
  matchType: MatchType;
  pattern: string;
  ignoreCase?: boolean;
  reason?: string | null;
  enabled?: boolean;
}

/** Résultat d'un recalcul : de quoi dire à l'admin ce que sa règle a fait. */
export interface ApplyResult {
  hidden: number;
  revealed: number;
}

function assertShape(input: RuleInput): void {
  if (!VISIBILITY_TYPES.includes(input.entityType))
    throw badRequest('Unknown entity type for a visibility rule', 'BAD_ENTITY_TYPE');
  if (!MATCH_TYPES.includes(input.matchType))
    throw badRequest('Unknown match type for a visibility rule', 'BAD_MATCH_TYPE');
  // Compile pour rejeter tout de suite une expression invalide ou trop lente : c'est le
  // seul instant où l'admin est là pour la corriger.
  compileRule({ ...input, ignoreCase: input.ignoreCase ?? true });
}

// ───────────────────────────── Règles ─────────────────────────────

export async function listRules(studioId: number, projectId?: number | null): Promise<VisibilityRule[]> {
  return prisma.visibilityRule.findMany({
    where: {
      studioId,
      // Une règle de studio vaut pour tous ses projets : la liste d'un projet montre donc
      // les deux niveaux, sinon l'admin ne comprendrait pas pourquoi un plan reste masqué.
      ...(projectId === undefined ? {} : { OR: [{ projectId: null }, { projectId }] }),
    },
    orderBy: [{ projectId: 'asc' }, { entityType: 'asc' }, { pattern: 'asc' }],
  });
}

export async function createRule(
  studioId: number,
  authorId: number | null,
  input: RuleInput,
): Promise<{ rule: VisibilityRule; applied: ApplyResult }> {
  assertShape(input);
  if (input.projectId != null) await assertProjectOfStudio(studioId, input.projectId);
  const rule = await prisma.visibilityRule.create({
    data: {
      studioId,
      projectId: input.projectId ?? null,
      entityType: input.entityType,
      matchType: input.matchType,
      pattern: input.pattern.trim(),
      ignoreCase: input.ignoreCase ?? true,
      reason: input.reason?.trim() || null,
      enabled: input.enabled ?? true,
      createdById: authorId,
    },
  });
  const applied = await applyRules(studioId, input.projectId ?? undefined);
  return { rule, applied };
}

export async function updateRule(
  studioId: number,
  id: number,
  input: Partial<RuleInput>,
): Promise<{ rule: VisibilityRule; applied: ApplyResult }> {
  const existing = await prisma.visibilityRule.findFirst({ where: { id, studioId } });
  if (!existing) throw notFound('Visibility rule not found');
  const merged: RuleInput = {
    entityType: (input.entityType ?? existing.entityType) as VisibilityType,
    matchType: (input.matchType ?? existing.matchType) as MatchType,
    pattern: input.pattern ?? existing.pattern,
    ignoreCase: input.ignoreCase ?? existing.ignoreCase,
  };
  assertShape(merged);
  const rule = await prisma.visibilityRule.update({
    where: { id },
    data: {
      entityType: merged.entityType,
      matchType: merged.matchType,
      pattern: merged.pattern.trim(),
      ignoreCase: merged.ignoreCase ?? true,
      ...(input.reason !== undefined ? { reason: input.reason?.trim() || null } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  const applied = await applyRules(studioId);
  return { rule, applied };
}

export async function deleteRule(studioId: number, id: number): Promise<ApplyResult> {
  const existing = await prisma.visibilityRule.findFirst({ where: { id, studioId } });
  if (!existing) throw notFound('Visibility rule not found');
  await prisma.visibilityRule.delete({ where: { id } });
  // Le recalcul lève le masquage de ce que plus aucune règle ne revendique : c'est lui,
  // et non la suppression, qui fait réapparaître les éléments.
  return applyRules(studioId);
}

async function assertProjectOfStudio(studioId: number, projectId: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project || project.studioId !== studioId)
    throw badRequest('This project does not belong to this studio', 'BAD_PROJECT');
}

// ───────────────────────────── Masquage manuel ─────────────────────────────

/**
 * « Masque cet élément-ci ».
 *
 * Sans règle : `hiddenRuleId` reste nul, et aucun recalcul ne lèvera ce masquage. C'est ce
 * qui distingue la décision d'un admin sur un élément précis de l'effet d'une convention.
 */
export async function setHidden(
  type: VisibilityType,
  id: number,
  hidden: boolean,
  reason?: string | null,
): Promise<void> {
  if (type === 'all') throw badRequest('Choose a single element to hide', 'BAD_ENTITY_TYPE');
  const data = hidden
    ? { hiddenAt: new Date(), hiddenReason: reason?.trim() || null, hiddenRuleId: null }
    : { hiddenAt: null, hiddenReason: null, hiddenRuleId: null };
  await writeVisibility(type, [id], data);
}

/** Ce qu'une écriture de visibilité pose — les trois colonnes vont toujours ensemble. */
interface VisibilityPatch {
  hiddenAt: Date | null;
  hiddenReason: string | null;
  hiddenRuleId: number | null;
}

/** Écrit l'état de visibilité sur un lot d'entités d'un même type. */
async function writeVisibility(
  type: Exclude<VisibilityType, 'all'>,
  ids: number[],
  data: VisibilityPatch,
): Promise<void> {
  if (ids.length === 0) return;
  const where = { id: { in: ids } };
  switch (type) {
    case 'episode':
      await prisma.episode.updateMany({ where, data });
      return;
    case 'sequence':
      await prisma.sequence.updateMany({ where, data });
      return;
    case 'shot':
      await prisma.shot.updateMany({ where, data });
      return;
    case 'asset':
      await prisma.asset.updateMany({ where, data });
      return;
  }
}

// ───────────────────────────── Recalcul ─────────────────────────────

interface Candidate {
  id: number;
  code: string | null;
  name: string;
  hiddenRuleId: number | null;
}

/**
 * Les lignes susceptibles de changer d'état : les visibles (candidates au masquage) et
 * celles qu'une règle tient (candidates à la levée). Ce qui est masqué à la main
 * (`hiddenAt` posé, `hiddenRuleId` nul) n'entre jamais dans le lot.
 *
 * Les quatre délégués Prisma ont la même forme, mais aucun type commun ne les réunit : le
 * `switch` est le prix à payer pour rester typé de bout en bout. Un asset n'a pas de code —
 * son nom en tient lieu, comme partout ailleurs.
 */
async function candidatesOf(projectId: number, type: Exclude<VisibilityType, 'all'>): Promise<Candidate[]> {
  const where = {
    projectId,
    // Ce qui est en corbeille ne s'affiche déjà plus : le masquer ne changerait rien, et
    // le relire à chaque passe coûterait sur les projets anciens.
    deletedAt: null,
    OR: [{ hiddenAt: null }, { hiddenRuleId: { not: null } }],
  };
  const select = { id: true, code: true, name: true, hiddenRuleId: true };
  switch (type) {
    case 'episode':
      return prisma.episode.findMany({ where, select });
    case 'sequence':
      return prisma.sequence.findMany({ where, select });
    case 'shot':
      return prisma.shot.findMany({ where, select });
    case 'asset': {
      const assets = await prisma.asset.findMany({
        where,
        select: { id: true, name: true, hiddenRuleId: true },
      });
      return assets.map((a) => ({ ...a, code: null }));
    }
  }
}

/**
 * Rejoue les règles d'un studio (ou d'un seul projet) sur les quatre types d'entités.
 *
 * Deux invariants tiennent l'ensemble :
 *   - un élément masqué **à la main** (`hiddenRuleId` nul) n'est jamais touché ;
 *   - un élément masqué **par une règle** est démasqué dès que plus aucune règle ne le
 *     couvre — sinon supprimer une règle ne rendrait jamais ses éléments.
 */
export async function applyRules(studioId: number, projectId?: number): Promise<ApplyResult> {
  const rules = await prisma.visibilityRule.findMany({
    where: {
      studioId,
      enabled: true,
      ...(projectId === undefined ? {} : { OR: [{ projectId: null }, { projectId }] }),
    },
  });
  const projects = await prisma.project.findMany({
    where: { studioId, ...(projectId === undefined ? {} : { id: projectId }) },
    select: { id: true },
  });

  let hidden = 0;
  let revealed = 0;
  for (const project of projects) {
    // Une règle de studio vaut partout ; une règle de projet ne vaut que chez elle.
    const scoped = rules.filter((r) => r.projectId === null || r.projectId === project.id);
    for (const type of Object.keys(TABLES) as Exclude<VisibilityType, 'all'>[]) {
      const applicable = scoped.filter((r) => coversType(r.entityType, type));
      const result = await applyToType(project.id, type, applicable);
      hidden += result.hidden;
      revealed += result.revealed;
    }
  }
  return { hidden, revealed };
}

async function applyToType(
  projectId: number,
  type: Exclude<VisibilityType, 'all'>,
  rules: VisibilityRule[],
): Promise<ApplyResult> {
  // Rien à masquer, mais peut-être à démasquer : les éléments qu'une règle disparue tient
  // encore. Ne pas lire la table dans ce cas laisserait un masquage orphelin à vie.
  const compiled = rules.map((rule) => ({ id: rule.id, test: safeCompile(rule) }));

  const rows = await candidatesOf(projectId, type);

  const toHide = new Map<number, number>();
  const toReveal: number[] = [];
  for (const row of rows) {
    const candidates = matchCandidates(row);
    const matching = compiled.find((rule) => candidates.some(rule.test));
    if (matching) {
      // Déjà masqué par la même règle : ne rien réécrire, sinon chaque passe toucherait
      // `updatedAt` et ferait croire à la synchronisation ShotGrid que ReView a bougé.
      if (row.hiddenRuleId !== matching.id) toHide.set(row.id, matching.id);
    } else if (row.hiddenRuleId !== null) {
      toReveal.push(row.id);
    }
  }

  // Groupé par règle : masquer deux mille plans un par un tenait la base occupée le temps
  // qu'un import ShotGrid entier se termine.
  const byRule = new Map<number, number[]>();
  for (const [id, ruleId] of toHide) byRule.set(ruleId, [...(byRule.get(ruleId) ?? []), id]);
  const now = new Date();
  for (const [ruleId, ids] of byRule) {
    await writeVisibility(type, ids, { hiddenAt: now, hiddenRuleId: ruleId, hiddenReason: null });
  }
  await writeVisibility(type, toReveal, { hiddenAt: null, hiddenRuleId: null, hiddenReason: null });
  return { hidden: toHide.size, revealed: toReveal.length };
}

/**
 * Compile une règle déjà enregistrée sans faire échouer le lot.
 *
 * Une règle est validée à l'écriture, mais rien ne garantit qu'elle le reste : une base
 * restaurée, une écriture directe, un changement de moteur. Une seule règle illisible ne
 * doit pas empêcher les autres de s'appliquer — elle est signalée et ne masque rien.
 */
function safeCompile(rule: VisibilityRule): (candidate: string) => boolean {
  try {
    return compileRule({
      matchType: rule.matchType as MatchType,
      pattern: rule.pattern,
      ignoreCase: rule.ignoreCase,
    });
  } catch {
    logger.warn({ ruleId: rule.id, pattern: rule.pattern }, 'Règle de masquage illisible, ignorée');
    return () => false;
  }
}

// ───────────────────────────── Lecture ─────────────────────────────

/**
 * Le filtre à poser sur toute liste d'entités de pipeline.
 *
 * Un admin voit ce qu'il a masqué — sinon il n'aurait aucun moyen de le démasquer, et le
 * geste serait sans retour. Tout le monde d'autre ne le voit nulle part.
 */
export function visibleWhere(includeHidden: boolean): { hiddenAt?: null } {
  return includeHidden ? {} : { hiddenAt: null };
}

/** Même filtre, pour une relation imbriquée (`sequence: { ... }`). */
export function visibleNested(includeHidden: boolean): Prisma.SequenceWhereInput {
  return includeHidden ? {} : { hiddenAt: null };
}
