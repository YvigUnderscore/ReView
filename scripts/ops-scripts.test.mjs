// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants des scripts d'exploitation (install, update, backup, restore).
 *
 * Ces quatre scripts sont ce qu'un studio tiers exécute sans nous, sur des données qu'on ne
 * reverra jamais. Aucun compilateur ne les relit : les contrôles ci-dessous verrouillent
 * les propriétés dont la disparition ne se voit qu'un jour de panne — un secret par défaut
 * qui survit à l'installation, une mise à jour qui bascule sans sauvegarde, une sauvegarde
 * redevenue une archive intégrale, un retour arrière silencieux sur la base.
 *
 * Lecture textuelle assumée : le dépôt n'embarque aucun analyseur shell, et en ajouter un
 * pour vérifier une poignée d'invariants serait disproportionné.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Retire commentaires, lignes d'affichage et corps de heredoc : on inspecte ce qui
 * S'EXÉCUTE, pas la prose — un message qui *décrit* une commande de restauration ne doit
 * pas passer pour une restauration lancée dans le dos de l'opérateur.
 */
export function commandsOf(script) {
  const out = [];
  let heredoc = null;
  for (const line of script.split(/\r?\n/)) {
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    const opener = /<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(line);
    if (opener) heredoc = opener[1];
    if (/^\s*#/.test(line) || /^\s*(echo|printf|say|ok|warn|die) /.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

const INSTALL = read('scripts/install.sh');
const UPDATE = read('scripts/update.sh');
const BACKUP = read('scripts/backup.sh');
const RESTORE = read('scripts/restore.sh');

describe('les quatre scripts d’exploitation', () => {
  const scripts = { INSTALL, UPDATE, BACKUP, RESTORE };
  for (const [name, script] of Object.entries(scripts)) {
    it(`échoue au premier faux pas et porte son en-tête de licence (${name})`, () => {
      expect(script).toMatch(/^set -euo pipefail$/m);
      expect(script).toMatch(/SPDX-License-Identifier: AGPL-3\.0-or-later/);
    });

    /**
     * Piège classique et silencieux : sous `set -e`, une instruction `[ test ] && action`
     * dont le test est FAUX rend un code non nul et **fait sortir le script**. Écrite
     * telle quelle, la sauvegarde de l'ancien .env arrêtait l'installateur à la première
     * installation — celle où .env n'existe justement pas encore. Un `if`, ou un
     * `|| autre-chose` final, retire le piège.
     */
    it(`n'enchaîne aucune action sur un test nu (piège set -e) (${name})`, () => {
      const offenders = commandsOf(script)
        .split('\n')
        .filter((line) => /^\s*\[[^\]]*\]\s+&&/.test(line) && !/\|\||\\\s*$|;\s*then/.test(line));
      expect(offenders).toEqual([]);
    });
  }
});

describe('scripts/install.sh', () => {
  const commands = commandsOf(INSTALL);

  it('tire chaque secret au hasard — aucun mot de passe par défaut ne survit', () => {
    expect(INSTALL).toMatch(/openssl rand -hex 32/);
    // Repli sans openssl : un NAS minimal n'en a pas toujours.
    expect(INSTALL).toMatch(/\/dev\/urandom/);
    for (const key of ['JWT_SECRET', 'POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'APP_ENCRYPTION_KEY']) {
      expect(commands, key).toMatch(new RegExp(`${key}="?\\$\\(gen_secret\\)`));
    }
    // Les défauts du dépôt de développement ne doivent jamais atterrir dans un .env produit.
    expect(commands).not.toMatch(/minioadmin/);
    expect(commands).not.toMatch(/change_me/);
  });

  it('écrit un .env complet, à droits restreints', () => {
    for (const key of ['APP_URL', 'CORS_ORIGIN', 'S3_PUBLIC_ENDPOINT', 'TZ', 'DATA_ROOT', 'APP_VERSION']) {
      expect(INSTALL, key).toContain(`${key}=`);
    }
    expect(commands).toMatch(/chmod 600 \.env/);
  });

  it('fige la pile dans COMPOSE_FILE (le piège du second -f oublié)', () => {
    expect(INSTALL).toMatch(/COMPOSE_FILE=\$COMPOSE_FILES/);
    expect(INSTALL).toMatch(/docker-compose\.prod\.yml/);
    // Sans séparateur explicite, la liste ne se lit qu'avec le séparateur du système
    // (« ; » sous Windows) : le même .env cesserait d'être compris d'un poste à l'autre.
    expect(INSTALL).toMatch(/COMPOSE_PATH_SEPARATOR=:/);
  });

  it('ne modifie aucun fichier versionné : la configuration du site est rendue dans deploy/', () => {
    expect(commands).toMatch(/nginx\/nginx\.conf > deploy\/nginx\.conf/);
    expect(commands).toContain('deploy/compose.site.yml');
    // Une réécriture en place de nginx/nginx.conf ferait échouer toute mise à jour par git.
    expect(commands).not.toMatch(/sed -i[^\n]*nginx\/nginx\.conf/);
  });

  it('refuse d’écraser une instance déjà installée sans --force', () => {
    expect(commands).toMatch(/\[ -f \.env \] && \[ "\$FORCE" -eq 0 \]/);
  });

  it('attend la DISPONIBILITÉ réelle, pas seulement un process vivant', () => {
    expect(INSTALL).toContain('/health/ready');
    expect(INSTALL).toMatch(/setup/);
  });

  it('exige docker compose ≥ 2.24 (l’overlay de production utilise « !reset »)', () => {
    expect(INSTALL).toMatch(/COMPOSE_MINOR.*-lt 24|-lt 24/);
  });
});

describe('scripts/update.sh', () => {
  const commands = commandsOf(UPDATE);

  it('sauvegarde avant de basculer', () => {
    const backupAt = commands.indexOf('scripts/backup.sh');
    const switchAt = Math.min(
      ...['docker compose pull', 'docker compose up -d --build']
        .map((cmd) => commands.indexOf(cmd))
        .filter((i) => i >= 0),
    );
    expect(backupAt).toBeGreaterThan(-1);
    expect(backupAt).toBeLessThan(switchAt);
  });

  it('interrompt la mise à jour si la sauvegarde n’aboutit pas', () => {
    expect(commands).toMatch(/BACKUP_ID.*\n?.*\|\| die|\[ -n "\$BACKUP_ID" \] \|\| die/);
  });

  it('vérifie la disponibilité après bascule, puis revient en arrière', () => {
    expect(commands).toContain('/health/ready');
    expect(commands).toMatch(/git checkout --quiet "\$PREVIOUS_REF"/);
    expect(commands).toMatch(/env_set APP_VERSION "\$PREVIOUS_VERSION"/);
  });

  it('n’efface jamais la base en silence : le retour arrière de données reste manuel', () => {
    expect(commands).not.toMatch(/restore\.sh (db|all)/);
    // …mais la commande exacte est écrite à l'opérateur.
    expect(UPDATE).toMatch(/scripts\/restore\.sh db backups\//);
  });

  it('refuse un « latest » implicite en mode registre', () => {
    expect(commands).toMatch(/\[ -n "\$TARGET" \] \|\| die/);
  });

  it('inscrit la version en service dans .env avant de démarrer', () => {
    const setAt = commands.indexOf('env_set APP_VERSION "$NEW_VERSION"');
    const upAt = commands.indexOf('docker compose up -d --build');
    expect(setAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(upAt);
  });

  // ── Quatre pannes constatées, et refermées ────────────────────────────────
  //
  // Elles étaient toutes invisibles tant que la mise à jour se lançait à la main, devant un
  // terminal, sur une instance qui remontait bien. Elles cessent de l'être le jour où c'est
  // l'administration qui commande, sans terminal et sans personne pour relire le journal.

  it('n’obéit jamais à un « up -d » nu : sinon le retour arrière est inatteignable', () => {
    // `worker` ET `frontend` dépendent de `backend: condition: service_healthy`. Un backend
    // qui ne devient pas sain — une migration Prisma en échec, la panne la plus courante
    // d'une mise à jour — fait sortir `up -d` en erreur ; sous `set -e`, un appel nu tue le
    // script AVANT la section 4, c'est-à-dire précisément dans le cas où elle sert.
    const bare = commands
      .split('\n')
      .filter((line) => line.includes('docker compose up -d'))
      .filter((line) => !/^\s*if ! /.test(line) && !/\|\|\s*true\s*$/.test(line));
    expect(bare).toEqual([]);
  });

  it('valide « --timeout » comme un nombre avant de le faire entrer dans une arithmétique', () => {
    // `$(( SECONDS + READY_TIMEOUT ))` ré-évalue le CONTENU de la variable : « x[$(cmd)] »
    // s'y exécute. Ce champ vient désormais d'un ordre déposé par l'application.
    expect(UPDATE).toMatch(/case "\$READY_TIMEOUT" in\s*\n\s*''\|\*\[!0-9\]\*\)/);
  });

  it('n’écrit jamais son journal par « tee /dev/stderr » (rouvert en troncature)', () => {
    expect(commands).not.toMatch(/tee \/dev\/stderr/);
    expect(commands).toMatch(/tee -a/);
  });

  it('repose l’étiquette qui tourne quand la récupération des images échoue', () => {
    // Sinon `.env` reste sur une étiquette inexistante et TOUTE commande docker compose
    // ultérieure échoue — y compris celle par laquelle l'exploitant essaierait de s'en tirer.
    expect(commands).toMatch(
      /if ! docker compose pull; then[\s\S]{0,300}?env_set REVIEW_IMAGE_TAG "\$PREVIOUS_TAG"/,
    );
  });

  it('jalonne son exécution : le code de sortie ne dit pas OÙ l’on s’est arrêté', () => {
    for (const milestone of ['precheck', 'backup', 'switch', 'health', 'rollback', 'done']) {
      expect(UPDATE, milestone).toMatch(new RegExp(`^\\s*phase ${milestone}$`, 'm'));
    }
    expect(UPDATE).toMatch(/OPS_PHASE=%s/);
  });
});

describe('scripts/backup.sh', () => {
  const commands = commandsOf(BACKUP);

  it('sauvegarde les objets de façon incrémentale par défaut', () => {
    expect(commands).toMatch(/MODE="\$\{BACKUP_MODE:-mirror\}"/);
    expect(commands).toMatch(/mirror --overwrite --remove/);
    // L'instantané est fait de liens durs : sept rétentions ne coûtent pas sept copies.
    expect(commands).toMatch(/cp -al/);
  });

  it('ne fabrique un tar du volume entier que sur demande explicite', () => {
    const tarLine = commands.split('\n').find((l) => l.includes('tar czf'));
    expect(tarLine).toBeTruthy();
    expect(commands).toMatch(/archive\)/);
  });

  it('abandonne sur un dump vide', () => {
    expect(commands).toMatch(/\[ -s "\$BACKUP_DIR\/\$STAMP\/db\.dump" \]/);
  });

  it('publie un identifiant lisible par une machine (repris par update.sh)', () => {
    expect(BACKUP.trim().endsWith('echo "BACKUP_ID=$STAMP"')).toBe(true);
    expect(UPDATE).toMatch(/BACKUP_ID=/);
  });

  it('ne purge jamais le miroir vivant', () => {
    expect(commands).toMatch(/grep -Ev '\/minio-current\/\$'/);
  });

  it('écrit un manifeste qui date la sauvegarde et nomme la version', () => {
    expect(commands).toMatch(/manifest\.txt/);
    expect(BACKUP).toMatch(/app_version=/);
  });
});

describe('scripts/restore.sh', () => {
  const commands = commandsOf(RESTORE);

  it('couvre les quatre modes, dont la vérification non destructive', () => {
    for (const mode of ['db)', 'minio)', 'all)', 'verify)']) {
      expect(commands, mode).toContain(mode);
    }
  });

  it('lit encore les anciennes sauvegardes (archive tar.gz)', () => {
    expect(commands).toMatch(/tar xzf/);
  });

  it('vérifie sur une base jetable, puis la supprime', () => {
    expect(commands).toMatch(/createdb .*\$CHECK_DB/);
    expect(commands).toMatch(/dropdb .*\$CHECK_DB/);
    // Un dump qui ne rend qu'une poignée de tables n'est pas une sauvegarde utilisable.
    expect(commands).toMatch(/TABLES:-0.*-gt 10|-gt 10/);
  });
});
