// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-end ShotGrid harness — start-up, scenario, shutdown.
 *
 * `fake-shotgrid.mjs` (site simulator) and `test-shotgrid-e2e.mjs` (scenario) were
 * written but had never run other than by hand: no command, no
 * validation step called them. Yet this is the only mechanism that verifies the most costly
 * invariant of the integration — never spilling over into the neighbouring project, since
 * "writing into the wrong project cannot be undone".
 *
 * This launcher switches on the simulator, waits for it to respond, plays the scenario, then switches it off
 * whatever happens. It returns the exit code of the scenario.
 *
 * **It writes into the database served by the running backend** (the scenario talks to
 * the HTTP API, not to an in-memory app): it therefore targets the docker stack of
 * development, and leaves behind the test project it created.
 *
 * Usage :
 *   node scripts/run-shotgrid-e2e.mjs
 *   REVIEW_API=http://localhost:3430 FAKE_SG_PORT=8890 node scripts/run-shotgrid-e2e.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = Number.parseInt(process.env.FAKE_SG_PORT ?? '8890', 10);
const CONTROL = process.env.FAKE_SG_CONTROL ?? `http://localhost:${PORT}`;
const API = process.env.REVIEW_API ?? 'http://localhost:3430';

/** Simulator timeout: it only opens one port, a second is more than enough. */
const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 250;

const say = (message) => console.log(message);

/** Does the simulator respond? Used at start-up as well as to detect an instance already running. */
async function simulatorAnswers() {
  try {
    const res = await fetch(`${CONTROL}/_control/state`, { signal: AbortSignal.timeout(1_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function backendAnswers() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startSimulator() {
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, 'scripts/fake-shotgrid.mjs'), '--port', String(PORT), '--quiet'],
    { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  child.on('error', (err) => {
    console.error(`\x1b[0;31m✗ Simulateur ShotGrid : ${err.message}\x1b[0m`);
  });
  return child;
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await simulatorAnswers()) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

function runScenario() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/test-shotgrid-e2e.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, FAKE_SG_CONTROL: CONTROL },
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  if (!(await backendAnswers())) {
    console.error(`\x1b[0;31m✗ Harnais ShotGrid : backend ReView injoignable sur ${API}\x1b[0m`);
    console.error('  → démarrer la stack docker (docker compose up -d) avant ce contrôle.');
    process.exit(1);
  }

  // A simulator already running (work in progress) is reused, and certainly not killed.
  const borrowed = await simulatorAnswers();
  let simulator = null;
  if (borrowed) {
    say(`\x1b[0;36m▶ Simulateur ShotGrid déjà en écoute sur ${CONTROL} — réutilisé\x1b[0m`);
  } else {
    say(`\x1b[0;36m▶ Démarrage du simulateur ShotGrid sur le port ${PORT}\x1b[0m`);
    simulator = startSimulator();
    if (!(await waitUntilReady())) {
      simulator.kill();
      console.error(
        `\x1b[0;31m✗ Le simulateur ShotGrid n'a pas répondu en ${READY_TIMEOUT_MS / 1000} s.\x1b[0m`,
      );
      process.exit(1);
    }
  }

  let code;
  try {
    code = await runScenario();
  } finally {
    if (simulator) {
      simulator.kill();
      say('\x1b[0;36m▶ Simulateur ShotGrid arrêté\x1b[0m');
    }
  }
  process.exit(code);
}

main().catch((err) => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});
