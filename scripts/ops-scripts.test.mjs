// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants des scripts d'exploitation (install, update, backup, restore).
 *
 * These four scripts are what a third-party studio runs without us, on data we
 * will never see again. No compiler reads them: the checks below lock down
 * the properties whose loss only shows on a day of failure — a default secret
 * that survives installation, an update that switches over without a backup, a backup
 * turned back into a full archive, a silent rollback of the database.
 *
 * Deliberately textual reading: the repository ships no shell parser, and adding one
 * to check a handful of invariants would be disproportionate.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Removes comments, display lines and heredoc bodies: we inspect what
 * IS EXECUTED, not the prose — a message that *describes* a restore command must not
 * pass for a restore launched behind the operator's back.
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
     * Classic and silent trap: under `set -e`, a statement `[ test ] && action`
     * whose test is FALSE returns a non-zero code and **exits the script**. Written
     * as is, the backup of the old .env stopped the installer at the first
     * installation — the very one where .env does not exist yet. An `if`, or a
     * final `|| something-else`, removes the trap.
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
    // Fallback without openssl: a minimal NAS does not always have it.
    expect(INSTALL).toMatch(/\/dev\/urandom/);
    for (const key of ['JWT_SECRET', 'POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'APP_ENCRYPTION_KEY']) {
      expect(commands, key).toMatch(new RegExp(`${key}="?\\$\\(gen_secret\\)`));
    }
    // The defaults of the development repository must never land in a produced .env.
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
    // Without an explicit separator, the list is only readable with the system separator
    // (";" under Windows): the same .env would stop being understood from one workstation to another.
    expect(INSTALL).toMatch(/COMPOSE_PATH_SEPARATOR=:/);
  });

  it('ne modifie aucun fichier versionné : la configuration du site est rendue dans deploy/', () => {
    expect(commands).toMatch(/nginx\/nginx\.conf > deploy\/nginx\.conf/);
    expect(commands).toContain('deploy/compose.site.yml');
    // An in-place rewrite of nginx/nginx.conf would make every git update fail.
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
    // …but the exact command is written out for the operator.
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

  // ── Four observed failures, and closed ────────────────────────────────
  //
  // They were all invisible as long as the update was launched by hand, in front of a
  // terminal, on an instance that came back up fine. They stop being so the day it is
  // the administration that orders it, without a terminal and without anyone to read the log.

  it('n’obéit jamais à un « up -d » nu : sinon le retour arrière est inatteignable', () => {
    // `worker` AND `frontend` depend on `backend: condition: service_healthy`. A backend
    // that does not become healthy — a failed Prisma migration, the most common failure
    // of an update — makes `up -d` exit with an error; under `set -e`, a bare call kills the
    // script BEFORE section 4, that is, precisely in the case where it is needed.
    const bare = commands
      .split('\n')
      .filter((line) => line.includes('docker compose up -d'))
      .filter((line) => !/^\s*if ! /.test(line) && !/\|\|\s*true\s*$/.test(line));
    expect(bare).toEqual([]);
  });

  it('valide « --timeout » comme un nombre avant de le faire entrer dans une arithmétique', () => {
    // `$(( SECONDS + READY_TIMEOUT ))` re-evaluates the CONTENT of the variable: "x[$(cmd)]"
    // runs there. This field now comes from an order dropped by the application.
    expect(UPDATE).toMatch(/case "\$READY_TIMEOUT" in\s*\n\s*''\|\*\[!0-9\]\*\)/);
  });

  it('n’écrit jamais son journal par « tee /dev/stderr » (rouvert en troncature)', () => {
    expect(commands).not.toMatch(/tee \/dev\/stderr/);
    expect(commands).toMatch(/tee -a/);
  });

  it('repose l’étiquette qui tourne quand la récupération des images échoue', () => {
    // Otherwise `.env` stays on a non-existent label and EVERY later docker compose
    // command fails — including the one the operator would use to get out of it.
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
    // The snapshot is made of hard links: seven retentions do not cost seven copies.
    expect(commands).toMatch(/cp -al/);
  });

  it("prend `mc` dans l'image du conteneur MinIO en marche, sans registre", () => {
    // By image ID: the nightly backup depends on no reachable repository, and the
    // client is the server's. A separate client image (`minio/mc`) has ceased to exist.
    for (const [name, script] of [
      ['backup.sh', commands],
      ['restore.sh', commandsOf(RESTORE)],
    ]) {
      expect(script, name).toMatch(/docker inspect -f '\{\{\.Image\}\}' "\$MINIO"/);
      const runs = script
        .replace(/\\\n\s*/g, ' ') // a command continued with `\` is read as one line
        .split('\n')
        .filter((l) => /--network "container:\$MINIO"/.test(l));
      expect(runs.length, name).toBeGreaterThan(0);
      for (const run of runs) expect(run, name).toMatch(/--entrypoint mc/);
    }
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
    // Only <YYYYMMDD-HHMMSS> directories are rotation candidates: `minio-current` never matches.
    expect(commands).toMatch(/grep -E '\/\[0-9\]\{8\}-\[0-9\]\{6\}\$'/);
    expect(commands).not.toMatch(/rm -rf "\$dir"/);
  });

  it('refuse un BACKUP_KEEP invalide (0 purgerait toutes les sauvegardes)', () => {
    expect(BACKUP).toMatch(/BACKUP_KEEP must be a positive integer >= 1/);
    expect(commands).toMatch(/\*\[!0-9\]\*\|0\|0\[0-9\]\*/);
  });

  it('ne passe aucun identifiant MinIO en ligne de commande ni par repli minioadmin', () => {
    expect(commands).not.toMatch(/minioadmin/);
    expect(commands).not.toMatch(/-e "MC_HOST_/);
    expect(commands).toMatch(/--env-file "\$MC_ENVFILE"/);
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
    // A dump that yields only a handful of tables is not a usable backup.
    expect(commands).toMatch(/TABLES:-0.*-gt 10|-gt 10/);
  });
});
