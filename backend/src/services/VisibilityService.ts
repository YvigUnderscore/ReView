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
 * Hiding of items (admin).
 *
 * Hiding is **materialized**, not evaluated at read time: each covered entity carries `hiddenAt`, and every list filters
 * on this single column. It is the only way to keep the promise "hidden everywhere, without omission": evaluating an
 * expression on every query cannot be pushed down into SQL, would skew all paginated counts, and would have let through
 * the screens that had been forgotten to convert.
 *
 * Recalculation is therefore the mandatory checkpoint. It runs when a rule changes and after each ShotGrid import, which is
 * where the items to hide come into being.
 */

/** The four tables that carry hiding, and the field that identifies them. */
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

/** Outcome of a recalculation: enough to tell the admin what their rule did. */
export interface ApplyResult {
  hidden: number;
  revealed: number;
}

function assertShape(input: RuleInput): void {
  if (!VISIBILITY_TYPES.includes(input.entityType))
    throw badRequest('Unknown entity type for a visibility rule', 'BAD_ENTITY_TYPE');
  if (!MATCH_TYPES.includes(input.matchType))
    throw badRequest('Unknown match type for a visibility rule', 'BAD_MATCH_TYPE');
  // Compiles to reject an invalid or too slow expression right away: this is the only moment the admin
  // is there to fix it.
  compileRule({ ...input, ignoreCase: input.ignoreCase ?? true });
}

// ───────────────────────────── Rules ─────────────────────────────

export async function listRules(studioId: number, projectId?: number | null): Promise<VisibilityRule[]> {
  return prisma.visibilityRule.findMany({
    where: {
      studioId,
      // A studio rule applies to all its projects: a project's list therefore shows both levels, otherwise
      // the admin would not understand why a shot stays hidden.
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
  // Recalculation lifts the hiding of whatever no rule claims any more: it is that, and not the deletion,
  // that makes items reappear.
  return applyRules(studioId);
}

async function assertProjectOfStudio(studioId: number, projectId: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project || project.studioId !== studioId)
    throw badRequest('This project does not belong to this studio', 'BAD_PROJECT');
}

// ───────────────────────────── Manual hiding ─────────────────────────────

/**
 * "Hide this item".
 *
 * Without a rule: `hiddenRuleId` stays null, and no recalculation will lift this hiding. This is what distinguishes an
 * admin's decision on a specific item from the effect of a convention.
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

/** What a visibility write sets: the three columns always travel together. */
interface VisibilityPatch {
  hiddenAt: Date | null;
  hiddenReason: string | null;
  hiddenRuleId: number | null;
}

/** Writes the visibility state onto a batch of entities of the same type. */
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

// ───────────────────────────── Recalculation ─────────────────────────────

interface Candidate {
  id: number;
  code: string | null;
  name: string;
  hiddenRuleId: number | null;
}

/**
 * The rows liable to change state: the visible ones (candidates for hiding) and those a rule holds (candidates for lifting).
 * What is hidden by hand (`hiddenAt` set, `hiddenRuleId` null) never enters the batch.
 *
 * The four Prisma delegates have the same shape, but no common type unites them: the `switch` is the price to pay for staying
 * typed end to end. An asset has no code: its name takes its place, as everywhere else.
 */
async function candidatesOf(projectId: number, type: Exclude<VisibilityType, 'all'>): Promise<Candidate[]> {
  const where = {
    projectId,
    // What is in the trash is already no longer displayed: hiding it would change nothing, and
    // re-reading it on every pass would cost on old projects.
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
 * Replays a studio's rules (or those of a single project) across the four entity types.
 *
 * Two invariants hold the whole together:
 *   - an item hidden **by hand** (`hiddenRuleId` null) is never touched;
 *   - an item hidden **by a rule** is unhidden as soon as no rule covers it any more: otherwise deleting a rule would never
 *     restore its items.
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
    // A studio rule applies everywhere; a project rule applies only in its own project.
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
  // Nothing to hide, but perhaps something to unhide: the items a vanished rule still holds. Not reading the table in
  // this case would leave an orphaned hiding for life.
  const compiled = rules.map((rule) => ({ id: rule.id, test: safeCompile(rule) }));

  const rows = await candidatesOf(projectId, type);

  const toHide = new Map<number, number>();
  const toReveal: number[] = [];
  for (const row of rows) {
    const candidates = matchCandidates(row);
    const matching = compiled.find((rule) => candidates.some(rule.test));
    if (matching) {
      // Already hidden by the same rule: rewrite nothing, otherwise every pass would touch `updatedAt` and
      // make ShotGrid synchronization believe ReView had changed.
      if (row.hiddenRuleId !== matching.id) toHide.set(row.id, matching.id);
    } else if (row.hiddenRuleId !== null) {
      toReveal.push(row.id);
    }
  }

  // Grouped by rule: hiding two thousand shots one by one kept the database busy until an entire ShotGrid
  // import finished.
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
 * Compiles an already registered rule without failing the batch.
 *
 * A rule is validated on write, but nothing guarantees it stays valid: a restored database, a direct write, a change of engine.
 * A single unreadable rule must not prevent the others from applying: it is flagged and hides nothing.
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

// ───────────────────────────── Read ─────────────────────────────

/**
 * The filter to apply to every list of pipeline entities.
 *
 * An admin sees what they have hidden: otherwise they would have no way to unhide it, and the gesture would have no feedback.
 * Everyone else sees it nowhere.
 */
export function visibleWhere(includeHidden: boolean): { hiddenAt?: null } {
  return includeHidden ? {} : { hiddenAt: null };
}

/** Same filter, for a nested relation (`sequence: { ... }`). */
export function visibleNested(includeHidden: boolean): Prisma.SequenceWhereInput {
  return includeHidden ? {} : { hiddenAt: null };
}
