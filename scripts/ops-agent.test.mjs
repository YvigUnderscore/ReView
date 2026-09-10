// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants de l'agent d'exploitation.
 *
 * Ce conteneur détient `/var/run/docker.sock`, c'est-à-dire l'équivalent de root sur la
 * machine du studio, et il exécute ce que lui dépose une application joignable depuis
 * internet. Ce qui est verrouillé ici n'est pas du style : c'est la liste, littérale, des
 * choses qui font qu'un ordre reste un ordre et ne devient jamais une ligne de commande.
 *
 * Lecture textuelle assumée, comme `ops-scripts.test.mjs` : le dépôt n'embarque pas
 * d'analyseur shell, et en ajouter un pour vérifier une poignée d'invariants serait
 * disproportionné.
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
/** Les INSTRUCTIONS du Dockerfile : ses commentaires expliquent ce qu'il s'interdit. */
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
    // Un ordre est une donnée déposée par un service exposé sur internet. Le jour où l'une
    // de ces trois constructions s'applique à son contenu, ce n'est plus un vocabulaire
    // fermé, c'est un interpréteur de commandes accessible à distance.
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
    // `restore.sh db|all` écrase sans confirmation et sans terminal. Cela reste un geste
    // d'exploitant, devant un clavier — l'écran se contente d'afficher la commande.
    expect(agentCommands).not.toMatch(/restore\.sh" (db|all)/);
    expect(agentCommands).not.toMatch(/restore\.sh (db|all)/);
    expect(agentCommands).toMatch(/restore\.sh" verify/);
  });

  it('filtre chaque champ avant de le laisser atteindre une ligne de commande', () => {
    // L'étiquette finit en argument de git et de docker ; les durées finissent dans une
    // arithmétique bash, qui RÉ-ÉVALUE le contenu des variables qu'elle rencontre.
    expect(agentCommands).toMatch(/reject "\$id" BAD_VERSION/);
    expect(agentCommands).toMatch(/case "\$ready_timeout" in ''\|\*\[!0-9\]\*\)/);
    expect(agentCommands).toMatch(/case "\$max_runtime" in ''\|\*\[!0-9\]\*\)/);
    expect(agentCommands).toMatch(/reject "\$id" BAD_BACKUP_ID/);
  });

  it('refuse un lien symbolique, et ramasse l’ordre sans le déplacer', () => {
    // `mv` déplacerait la CIBLE d'un lien. `cat` puis `rm` ne suivent que la lecture.
    expect(agentCommands).toMatch(/\[ -L "\$next" \]/);
    expect(agentCommands).toMatch(/order="\$\(cat "\$next"\)"/);
    expect(agentCommands).not.toMatch(/mv "\$next"/);
  });

  it('refuse le rejeu par un mkdir qui échoue si le dossier existe', () => {
    expect(agentCommands).toMatch(/if ! mkdir "\$dir" 2>\/dev\/null; then reject "\$id" REPLAY/);
    expect(agentCommands).not.toMatch(/mkdir -p "\$dir"/);
  });

  it('vérifie que le dépôt est monté sur son chemin hôte avant tout ordre', () => {
    // Sans ce témoin, `backup.sh` écrirait son miroir MinIO dans un répertoire vide — sans
    // une seule erreur, découvert le jour de la restauration.
    expect(agentCommands).toMatch(/check_root_path/);
    // `--entrypoint` EST le contrôle : l'image utilisée est celle de l'agent, dont
    // l'entrypoint est l'agent lui-même. Sans cette option, « test -f … » deviennent ses
    // arguments, le témoin échoue toujours, et plus aucun ordre n'est exécutable.
    expect(agentCommands).toMatch(/docker run --rm --entrypoint test -v "\$ROOT\/ops\/state:\/w"/);
    expect(agentCommands).toMatch(/timeout \d+ docker run --rm --entrypoint test/);
    expect(agentCommands).toMatch(/reject "\$id" ROOT_MISMATCH/);
  });

  it('refuse de faire redescendre l’instance de version', () => {
    // C'est CE contrôle, et non la liste blanche du backend, qui tient si le backend est
    // compromis : une version antérieure ne sait pas lire un schéma déjà migré.
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
    // …et update.sh doit savoir retrouver le dépôt depuis ailleurs.
    expect(read('scripts/update.sh')).toMatch(/ROOT="\$\{REVIEW_ROOT:-\$\(cd/);
  });

  it('n’écrit jamais dans la file d’ordres, sauf pour consommer la sentinelle d’annulation', () => {
    // La file appartient au backend, l'état appartient à l'agent. Cette asymétrie est ce
    // qui empêche un backend compromis de faire écrire le démon docker n'importe où.
    const writes = agentCommands
      .split('\n')
      .filter((line) => /(?:>|>>|tee|cp|mv|touch)\s+"?\$QUEUE_DIR/.test(line));
    expect(writes).toEqual([]);
    expect(agentCommands).toMatch(/rm -f "\$QUEUE_DIR\/\$id\.cancel"/);
  });

  it('écrit ses fichiers d’état atomiquement', () => {
    // Le backend les lit en permanence : il ne doit jamais tomber sur un demi-JSON.
    expect(agentCommands).toMatch(/mv -f "\$tmp" "\$AGENT_FILE"/);
    expect(agentCommands).toMatch(/mv -f "\$tmp" "\$dir\/status\.json"/);
  });

  it('bat le cœur pendant l’exécution, pas seulement à vide', () => {
    // Sinon toute mise à jour réussie ferait passer l'agent pour mort en cours de route.
    const loop = agentCommands.slice(agentCommands.indexOf('while kill -0'));
    expect(loop).toMatch(/write_agent_state/);
  });

  it('purge les exécutions anciennes', () => {
    expect(agentCommands).toMatch(/purge_runs/);
  });
});

describe('ops/Dockerfile', () => {
  it('n’embarque rien du produit, et épingle sa base', () => {
    // Cette image détient le socket docker : moins elle contient, moins il y a à auditer.
    expect(DOCKERFILE).toMatch(/^FROM docker:\d+\.\d+\.\d+-cli$/m);
    expect(dockerInstructions).not.toMatch(/:latest/);
    expect(dockerInstructions).not.toMatch(/npm|node_modules/);
  });

  it('installe ce dont les gardes ont besoin', () => {
    // `sort -V` et `date -d` n'existent pas dans les applets busybox : sans coreutils, le
    // refus de rétrogradation et la péremption d'un ordre échoueraient en silence.
    for (const pkg of ['bash', 'jq', 'git', 'coreutils']) expect(dockerInstructions, pkg).toContain(pkg);
  });

  it('embarque la boucle dans l’image plutôt que de la lire depuis le dépôt monté', () => {
    // En mode construction, update.sh change la version du dépôt PENDANT l'exécution.
    expect(DOCKERFILE).toMatch(/COPY agent\.sh \/opt\/review-ops\/agent\.sh/);
    expect(DOCKERFILE).toMatch(/ENTRYPOINT \["\/bin\/bash", "\/opt\/review-ops\/agent\.sh"\]/);
  });
});

describe('docker-compose.ops.yml', () => {
  it('n’entre JAMAIS dans la pile principale', () => {
    // C'est l'invariant central : `update.sh` fait `docker compose up -d` sans liste de
    // services. Un agent déclaré dans cette pile se détruirait au milieu de son propre travail.
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
    // `deploy/` n'est monté dans aucun conteneur de l'application : c'est la barrière
    // qu'une session d'administration volée ne franchit pas.
    expect(commands).toMatch(/deploy\/agent\.conf/);
    expect(commands).toMatch(/chmod 600 deploy\/agent\.conf/);
    expect(CLI).toMatch(/OPS_ALLOW_DOWNGRADE=0/);
    expect(read('scripts/ops-agent.sh')).not.toMatch(/agent\.conf.*:\/[a-z]/);
  });

  it('recrée le backend après avoir posé les montages', () => {
    // Sans cela, le backend continue sans voir la file : l'écran dirait « aucun agent »
    // alors qu'il tourne, et personne ne comprendrait pourquoi.
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
    // Construire sur le serveur du studio, c'est 3,6 Go à compiler et une mise à jour
    // depuis l'interface qui n'a plus de sens sur un NAS.
    expect(commands).toMatch(/IMAGE_PREFIX="\$\(ask/);
    expect(commands).toMatch(/docker-compose\.release\.yml/);
    expect(commands).toMatch(/\[ -n "\$IMAGE_TAG" \] \|\| die/);
  });

  it('n’installe pas l’agent en mode construction, et ne s’arrête pas s’il échoue', () => {
    // Une instance dont l'agent ne démarre pas reste une instance qui fonctionne : ce
    // qu'on perd, ce sont les boutons, pas le service.
    expect(commands).toMatch(/if \[ -z "\$IMAGE_PREFIX" \]; then/);
    expect(commands).toMatch(/elif bash scripts\/ops-agent\.sh install; then/);
  });
});
