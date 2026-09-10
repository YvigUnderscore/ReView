// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey, Tr } from '../../i18n';
import type { InstanceVersion } from './aboutInstance';

/**
 * L'écran « Mises à jour & sauvegardes », côté données : la forme de `GET /api/admin/ops`
 * et les règles d'affichage qui vont avec.
 *
 * Fonctions pures dans leur propre module (comme `aboutInstance`, `adminShared`…) : elles
 * se testent sans monter React, et le composant n'exporte que lui-même.
 *
 * ⚠ Aucune table de libellés en constante de module : elle figerait la langue au
 * chargement du bundle. Toutes prennent `t` en paramètre, sans exception.
 */

/** Comment cette instance change de version — décide si l'écran propose un bouton. */
export type UpdateMode = 'registry' | 'build';

export interface ReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string | null;
  /** Notes de version, en markdown. Contenu DISTANT : rendu échappé (`renderDocHtml`). */
  notesMd: string;
  htmlUrl: string;
  prerelease: boolean;
}

export type ReleaseError = 'DISABLED' | 'UNREACHABLE' | 'RATE_LIMITED';

export interface BackupEntry {
  id: string;
  date: string | null;
  mode: string | null;
  bucket: string | null;
  fromRelease: string | null;
  dbBytes: number | null;
  envIncluded: boolean;
  /** Commande de restauration composée par le serveur — jamais fabriquée ici. */
  restoreCommand: string;
}

export interface BackupCatalog {
  available: boolean;
  dir: string | null;
  entries: BackupEntry[];
}

export type MechanismState = 'absent' | 'ready' | 'busy' | 'stalled' | 'blocked';

export interface Mechanism {
  state: MechanismState;
  reason: string | null;
  protocol: number | null;
  agentVersion: string | null;
  seenAt: string | null;
  allow: { update: boolean; backup: boolean; verify: boolean };
}

export type RunState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'rolled-back'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'rejected'
  | 'unknown';

export type OpsKind = 'update' | 'backup' | 'verify';

export interface RunSummary {
  id: string;
  kind: string;
  target: string | null;
  state: RunState;
  phase: string | null;
  reason: string | null;
  requestedBy: { id: number; displayName: string } | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  backupId: string | null;
  agentVersion: string | null;
  restoreCommand: string | null;
  cancellable: boolean;
}

export interface OpsOverview {
  current: InstanceVersion;
  mode: UpdateMode;
  latest: ReleaseInfo | null;
  /** Tout ce qui est paru depuis la version en service : la réponse à « ça change quoi ». */
  newer: ReleaseInfo[];
  release: { checkedAt: string | null; error: ReleaseError | null };
  updateAvailable: boolean;
  backups: BackupCatalog;
  mechanism: Mechanism;
  activeRun: RunSummary | null;
  recentRuns: RunSummary[];
  commands: { update: string | null; backup: string; enableAgent: string };
}

/** Réponse de `GET /api/admin/ops/runs/:id` — l'état, et une tranche de journal. */
export interface RunDetail {
  run: RunSummary;
  log: { from: number; next: number; text: string; truncated: boolean };
}

/** Un état terminal ne bougera plus : l'écran cesse de sonder, et le journal est complet. */
export function isTerminalState(state: RunState): boolean {
  return state !== 'queued' && state !== 'running';
}

/**
 * Libellé d'un état. La clé de l'état est en kebab-case (`rolled-back`, tel que l'agent
 * l'écrit), celle du message en camelCase : la table de correspondance est ici, une fois.
 */
export function runStateLabel(t: Tr, state: RunState): string {
  const key = state === 'rolled-back' ? 'rolledBack' : state;
  return t(`ops.run.state.${key}` as MessageKey);
}

/** Couleur de la pastille d'état — le vocabulaire de `Badge`. */
export function runStateVariant(state: RunState): 'success' | 'warning' | 'destructive' | 'info' | 'muted' {
  if (state === 'succeeded') return 'success';
  if (state === 'running' || state === 'queued') return 'info';
  // Un retour arrière n'est pas un échec : l'instance est debout, dans sa version d'avant.
  if (state === 'rolled-back' || state === 'unknown') return 'warning';
  if (state === 'failed') return 'destructive';
  return 'muted';
}

/** Jalons connus de `scripts/update.sh` ; tout autre mot vient d'une version plus récente. */
const KNOWN_PHASES = ['queued', 'precheck', 'backup', 'switch', 'health', 'rollback', 'done'];

/**
 * Libellé d'un jalon. Un jalon inconnu — un agent plus récent que cet écran — est rendu
 * tel quel plutôt que masqué : mieux vaut un mot anglais qu'une ligne vide.
 */
export function runPhaseLabel(t: Tr, phase: string | null): string {
  if (!phase) return t('ops.run.phase.queued');
  if (!KNOWN_PHASES.includes(phase)) return phase;
  return t(`ops.run.phase.${phase}` as MessageKey);
}

/** Libellé d'une opération. Le protocole peut en nommer une que cet écran ignore. */
export function runKindLabel(t: Tr, kind: string): string {
  if (kind !== 'update' && kind !== 'backup' && kind !== 'verify') return kind;
  return t(`ops.run.kind.${kind}` as MessageKey);
}

/** Ce que l'écran doit dire du mécanisme d'exécution, et sur quel ton. */
export interface MechanismNotice {
  tone: 'info' | 'warning';
  text: string;
  /** Commande de diagnostic à afficher, quand il y en a une d'utile. */
  command: string | null;
}

/**
 * Traduit l'état du mécanisme en message. `null` quand tout va bien : un bandeau permanent
 * qui dit « ça marche » finit par ne plus être lu, et masque celui qui compte.
 */
export function mechanismNotice(
  t: Tr,
  mechanism: Mechanism,
  commands: OpsOverview['commands'],
  formatDate: (iso: string) => string,
): MechanismNotice | null {
  switch (mechanism.state) {
    case 'absent':
      return { tone: 'info', text: t('ops.agent.absent'), command: commands.enableAgent };
    case 'stalled':
      return {
        tone: 'warning',
        text: t('ops.agent.stalled', { date: mechanism.seenAt ? formatDate(mechanism.seenAt) : '—' }),
        command: 'bash scripts/ops-agent.sh status',
      };
    case 'blocked':
      return mechanism.reason === 'PROTOCOL_UNSUPPORTED'
        ? { tone: 'warning', text: t('ops.agent.protocol'), command: 'bash scripts/ops-agent.sh upgrade' }
        : { tone: 'warning', text: t('ops.agent.rootMismatch'), command: 'bash scripts/ops-agent.sh status' };
    default:
      return null;
  }
}

/** Message d'indisponibilité du catalogue distant, ou `null` s'il a répondu. */
export function releaseErrorLabel(t: Tr, error: ReleaseError | null): string | null {
  if (error === 'UNREACHABLE') return t('ops.latest.unreachable');
  if (error === 'RATE_LIMITED') return t('ops.latest.rateLimited');
  if (error === 'DISABLED') return t('ops.latest.disabled');
  return null;
}

/**
 * Le bouton de mise à jour a-t-il un sens ?
 *
 * Le mode construction en est exclu **volontairement** : y basculer recompile des giga-octets
 * sur le serveur du studio, et `git checkout` réécrirait le dépôt sous les pieds d'une pile
 * en train de tourner. L'écran y affiche la commande, jamais un bouton.
 */
export function canUpdateFromHere(overview: OpsOverview): boolean {
  return (
    overview.mode === 'registry' &&
    overview.mechanism.state === 'ready' &&
    overview.mechanism.allow.update &&
    overview.updateAvailable &&
    overview.latest !== null
  );
}

/** Une sauvegarde est-elle commandable d'un clic ? */
export function canBackupFromHere(overview: OpsOverview): boolean {
  return overview.mechanism.state === 'ready' && overview.mechanism.allow.backup;
}
