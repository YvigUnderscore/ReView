// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants de l'agent d'exploitation.
 *
 * This container holds `/var/run/docker.sock`, that is the equivalent of root on the
 * studio machine, and it runs what an application reachable from
 * the internet drops into it. What is locked down here is not style: it is the literal list of
 * the things that keep an order an order and never turn it into a command line.
 *
 * Deliberately textual reading, like `ops-scripts.test.mjs`: the repository ships no
 * shell parser, and adding one to check a handful of invariants would be
 * disproportionate.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandsOf } from './ops-scripts.test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const AGENT = read('ops/agent.sh');
const CLI = read('scripts/ops-agent.sh');
const OPS_COMPOSE = read('docker-compose.ops.yml');
const INSTALL = read('scripts/install.sh');
const DOCKERFILE = read('ops/Dockerfile');
/** The INSTRUCTIONS of the Dockerfile: its comments explain what it forbids itself. */
const dockerInstructions = DOCKERFILE.split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const agentCommands = commandsOf(AGENT);

describe('ops/agent.sh — ce que l’agent accepte d’exécuter', () => {
  it('échoue au premier faux pas et porte son en-tête de licence', () => {
    expect(AGENT).toMatch(/^set -euo pipefail$/m);
    expect(AGENT).toMatch(/SPDX-License-Identifier: AGPL-3\.0-or-later/);
  });

  it('n’interprète JAMAIS un ordre : ni eval, ni source, ni substitution de commande', () => {
    // An order is data dropped by a service exposed on the internet. The day one of
    // these three constructs applies to its content, it is no longer a closed vocabulary,
    // it is a remotely reachable command interpreter.
    expect(agentCommands).not.toMatch(/\beval\b/);
    expect(agentCommands).not.toMatch(/^\s*(\.|source)\s+"?\$(order|ORDER)/m);
    expect(agentCommands).not.toMatch(/bash -c/);
  });

  it('lit l’ordre par jq, et refuse ce qui n’est pas un JSON', () => {
    expect(agentCommands).toMatch(/jq -r/);
    expect(agentCommands).toMatch(/jq -e \./);
  });

  it('n’accepte que trois opérations, nommées une par une', () => {
    expect(agentCommands).toMatch(/^\s*update\)/m);
    expect(agentCommands).toMatch(/^\s*backup\)/m);
    expect(agentCommands).toMatch(/^\s*verify\)/m);
    expect(agentCommands).toMatch(/\*\) reject "\$id" UNKNOWN_KIND/);
  });

  it('ne restaure jamais une base : seule la vérification est commandable', () => {
    // `restore.sh db|all` overwrites without confirmation and without a terminal. That remains a gesture
    // for an operator, in front of a keyboard — the screen merely displays the command.
    expect(agentCommands).not.toMatch(/restore\.sh" (db|all)/);
    expect(agentCommands).not.toMatch(/restore\.sh (db|all)/);
    expect(agentCommands).toMatch(/restore\.sh" verify/);
  });

  it('filtre chaque champ avant de le laisser atteindre une ligne de commande', () => {
    // The label ends up as an argument to git and docker; the durations end up in a
    // bash arithmetic, which RE-EVALUATES the contents of the variables it meets.
    expect(agentCommands).toMatch(/reject "\$id" BAD_VERSION/);
    expect(agentCommands).toMatch(/case "\$ready_timeout" in ''\|\*\[!0-9\]\*\)/);
    expect(agentCommands).toMatch(/case "\$max_runtime" in ''\|\*\[!0-9\]\*\)/);
    expect(agentCommands).toMatch(/reject "\$id" BAD_BACKUP_ID/);
  });

  it('refuse un lien symbolique, et ramasse l’ordre sans le déplacer', () => {
    // `mv` would move the TARGET of a link. `cat` then `rm` only follow the read.
    expect(agentCommands).toMatch(/\[ -L "\$next" \]/);
    expect(agentCommands).toMatch(/order="\$\(cat "\$next"\)"/);
    expect(agentCommands).not.toMatch(/mv "\$next"/);
  });

  it('refuse le rejeu par un mkdir qui échoue si le dossier existe', () => {
    expect(agentCommands).toMatch(/if ! mkdir "\$dir" 2>\/dev\/null; then reject "\$id" REPLAY/);
    expect(agentCommands).not.toMatch(/mkdir -p "\$dir"/);
  });

  it('vérifie que le dépôt est monté sur son chemin hôte avant tout ordre', () => {
    // Without this witness, `backup.sh` would write its MinIO mirror into an empty directory — without
    // a single error, discovered on the day of the restore.
    expect(agentCommands).toMatch(/check_root_path/);
    // `--entrypoint` IS the control: the image used is the agent's own, whose
    // entrypoint is the agent itself. Without this option, "test -f …" becomes its
    // arguments, the witness always fails, and no order is executable any more.
    expect(agentCommands).toMatch(/docker run --rm --entrypoint test -v "\$ROOT\/ops\/state:\/w"/);
    expect(agentCommands).toMatch(/timeout \d+ docker run --rm --entrypoint test/);
    expect(agentCommands).toMatch(/reject "\$id" ROOT_MISMATCH/);
  });

  it('refuse de faire redescendre l’instance de version', () => {
    // It is THIS check, and not the backend's allowlist, that holds if the backend is
    // compromised: an earlier version cannot read a schema already migrated.
    expect(agentCommands).toMatch(/sort -V/);
    expect(agentCommands).toMatch(/OPS_ALLOW_DOWNGRADE/);
    expect(agentCommands).toMatch(/reject "\$id" DOWNGRADE_REFUSED/);
  });

  it('borne chaque exécution dans le temps', () => {
    expect(agentCommands).toMatch(/timeout -k 30 "\$max_runtime"/);
  });

  it('passe --yes : update.sh lit sa confirmation sur /dev/tty, qui n’existe pas ici', () => {
    expect(agentCommands).toMatch(/--yes/);
  });

  it('copie update.sh hors du dépôt : git checkout réécrit le fichier en cours de lecture', () => {
    expect(agentCommands).toMatch(/cp -f "\$ROOT\/scripts\/update\.sh" "\$RUN_SCRIPT"/);
    expect(agentCommands).toMatch(/RUN_SCRIPT="\/tmp\//);
    // …and update.sh must be able to find the repository from elsewhere.
    expect(read('scripts/update.sh')).toMatch(/ROOT="\$\{REVIEW_ROOT:-\$\(cd/);
  });

  it('n’écrit jamais dans la file d’ordres, sauf pour consommer la sentinelle d’annulation', () => {
    // The queue belongs to the backend, the state belongs to the agent. This asymmetry is what
    // prevents a compromised backend from making the docker daemon write anywhere.
    const writes = agentCommands
      .split('\n')
      .filter((line) => /(?:>|>>|tee|cp|mv|touch)\s+"?\$QUEUE_DIR/.test(line));
    expect(writes).toEqual([]);
    expect(agentCommands).toMatch(/rm -f "\$QUEUE_DIR\/\$id\.cancel"/);
  });

  it('écrit ses fichiers d’état atomiquement', () => {
    // The backend reads them constantly: it must never hit a half-written JSON.
    expect(agentCommands).toMatch(/mv -f "\$tmp" "\$AGENT_FILE"/);
    expect(agentCommands).toMatch(/mv -f "\$tmp" "\$dir\/status\.json"/);
  });

  it('bat le cœur pendant l’exécution, pas seulement à vide', () => {
    // Otherwise every successful update would make the agent look dead along the way.
    const loop = agentCommands.slice(agentCommands.indexOf('while kill -0'));
    expect(loop).toMatch(/write_agent_state/);
  });

  it('purge les exécutions anciennes', () => {
    expect(agentCommands).toMatch(/purge_runs/);
  });
});

describe('ops/Dockerfile', () => {
  it('n’embarque rien du produit, et épingle sa base', () => {
    // This image holds the docker socket: the less it contains, the less there is to audit.
    expect(DOCKERFILE).toMatch(/^FROM docker:\d+\.\d+\.\d+-cli@sha256:[0-9a-f]{64}$/m);
    expect(dockerInstructions).not.toMatch(/:latest/);
    expect(dockerInstructions).not.toMatch(/npm|node_modules/);
  });

  it('installe ce dont les gardes ont besoin', () => {
    // `sort -V` and `date -d` do not exist in busybox applets: without coreutils, the
    // downgrade refusal and the expiry of an order would fail silently.
    for (const pkg of ['bash', 'jq', 'git', 'coreutils']) expect(dockerInstructions, pkg).toContain(pkg);
  });

  it('embarque la boucle dans l’image plutôt que de la lire depuis le dépôt monté', () => {
    // In build mode, update.sh changes the repository version DURING execution.
    expect(DOCKERFILE).toMatch(/COPY agent\.sh \/opt\/review-ops\/agent\.sh/);
    expect(DOCKERFILE).toMatch(/ENTRYPOINT \["\/bin\/bash", "\/opt\/review-ops\/agent\.sh"\]/);
  });
});

describe('docker-compose.ops.yml', () => {
  it('n’entre JAMAIS dans la pile principale', () => {
    // This is the central invariant: `update.sh` runs `docker compose up -d` without a list of
    // services. An agent declared in this stack would destroy itself in the middle of its own work.
    expect(commandsOf(INSTALL)).not.toContain('docker-compose.ops.yml');
    expect(read('docker-compose.yml')).not.toContain('docker-compose.ops.yml');
    expect(commandsOf(CLI)).toMatch(/docker compose -p "\$OPS_PROJECT" -f "\$OPS_FILE"/);
    expect(CLI).toMatch(/OPS_PROJECT="review-ops"/);
  });

  it('est le seul endroit du dépôt où le socket docker est monté', () => {
    expect(OPS_COMPOSE).toContain('/var/run/docker.sock:/var/run/docker.sock');
    for (const file of ['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.release.yml']) {
      expect(read(file), file).not.toContain('docker.sock');
    }
  });

  it('monte le dépôt sur son chemin hôte, et coupe le réseau du conteneur', () => {
    expect(OPS_COMPOSE).toMatch(/- \.:\$\{REVIEW_ROOT:\?/);
    expect(OPS_COMPOSE).toMatch(/network_mode: "none"/);
    expect(OPS_COMPOSE).toMatch(/mem_limit:/);
    expect(OPS_COMPOSE).toMatch(/max-size:/);
  });

  it('n’épingle pas l’agent sur une étiquette mouvante', () => {
    expect(OPS_COMPOSE).not.toMatch(/review-ops:latest/);
    expect(OPS_COMPOSE).toMatch(/\$\{REVIEW_OPS_IMAGE:\?/);
  });
});

describe('scripts/ops-agent.sh', () => {
  const commands = commandsOf(CLI);

  it('échoue au premier faux pas et porte son en-tête de licence', () => {
    expect(CLI).toMatch(/^set -euo pipefail$/m);
    expect(CLI).toMatch(/SPDX-License-Identifier: AGPL-3\.0-or-later/);
  });

  it('refuse de s’installer si l’agent a été mis dans la pile principale', () => {
    expect(commands).toMatch(/grep -q "\^COMPOSE_FILE=\.\*\$OPS_FILE" \.env/);
  });

  it('pose les deux montages avec la bonne asymétrie', () => {
    expect(CLI).toMatch(/\.\/backups:\/backups:ro/);
    expect(CLI).toMatch(/\.\/ops\/queue:\/ops\/queue$/m);
    expect(CLI).toMatch(/\.\/ops\/state:\/ops\/state:ro/);
  });

  it('écrit la configuration des autorisations hors de tout montage du backend', () => {
    // `deploy/` is mounted in no application container: it is the barrier
    // that a stolen administration session does not cross.
    expect(commands).toMatch(/deploy\/agent\.conf/);
    expect(commands).toMatch(/chmod 600 deploy\/agent\.conf/);
    expect(CLI).toMatch(/OPS_ALLOW_DOWNGRADE=0/);
    expect(read('scripts/ops-agent.sh')).not.toMatch(/agent\.conf.*:\/[a-z]/);
  });

  it('recrée le backend après avoir posé les montages', () => {
    // Without this, the backend carries on without seeing the queue: the screen would say "no agent"
    // while it is running, and nobody would understand why.
    expect(commands).toMatch(/docker compose up -d backend/);
  });
});

describe('scripts/install.sh — ce que l’installation pose en plus', () => {
  const commands = commandsOf(INSTALL);

  it('inscrit le chemin du dépôt et le nom du projet dans .env', () => {
    expect(INSTALL).toMatch(/^REVIEW_ROOT=\$ROOT$/m);
    expect(INSTALL).toMatch(/^COMPOSE_PROJECT_NAME=/m);
  });

  it('crée les dossiers de sauvegarde et la file d’ordres, à droits restreints', () => {
    expect(commands).toMatch(/mkdir -p backups ops\/queue ops\/state/);
    expect(commands).toMatch(/chmod 700 backups ops ops\/queue ops\/state/);
  });

  it('propose les images publiées, et exige alors une étiquette explicite', () => {
    // Building on the studio server means 3.6 GB to compile and an update
    // from the interface that makes no sense any more on a NAS.
    expect(commands).toMatch(/IMAGE_PREFIX="\$\(ask/);
    expect(commands).toMatch(/docker-compose\.release\.yml/);
    expect(commands).toMatch(/\[ -n "\$IMAGE_TAG" \] \|\| die/);
  });

  it('n’installe pas l’agent en mode construction, et ne s’arrête pas s’il échoue', () => {
    // An instance whose agent does not start remains a working instance: what
    // is lost are the buttons, not the service.
    expect(commands).toMatch(/if \[ -z "\$IMAGE_PREFIX" \]; then/);
    expect(commands).toMatch(/elif bash scripts\/ops-agent\.sh install; then/);
  });
});
