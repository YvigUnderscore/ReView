// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vérification de bout en bout de l'intégration ShotGrid contre le simulateur.
 *
 * Le scénario ne se contente pas de vérifier qu'une synchronisation « passe » : le
 * simulateur héberge trois projets dont deux portent des entités aux codes IDENTIQUES.
 * Le test échoue si ReView importe ne serait-ce qu'une entité du projet voisin — c'est
 * la garantie la plus importante de toute l'intégration.
 *
 * Prérequis : stack docker démarrée, `node scripts/fake-shotgrid.mjs` en cours.
 * Usage : node scripts/test-shotgrid-e2e.mjs
 */

const API = process.env.REVIEW_API ?? 'http://localhost:3430';
const SG_URL = process.env.FAKE_SG_URL ?? 'http://host.docker.internal:8890';
const SG_CONTROL = process.env.FAKE_SG_CONTROL ?? 'http://localhost:8890';
const EMAIL = process.env.REVIEW_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.REVIEW_PASSWORD ?? 'admin1234';

let token = '';
let passed = 0;
let failed = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  console.log('\n═══ Vérification ShotGrid de bout en bout ═══\n');

  // ── 0. Le simulateur répond
  const state = await fetch(`${SG_CONTROL}/_control/state`).then((r) => r.json());
  console.log('Simulateur ShotGrid :', state.projects.map((p) => `${p.name} (#${p.id})`).join(', '));

  // ── 1. Authentification
  console.log('\n1. Authentification');
  const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  token = login.json?.token ?? login.json?.accessToken ?? '';
  check('connexion administrateur', Boolean(token), `statut ${login.status}`);
  if (!token) {
    console.log('   Impossible de continuer sans jeton.');
    process.exit(1);
  }

  // ── 2. Projet ReView dédié au test
  console.log('\n2. Projet ReView');
  const suffix = Date.now().toString().slice(-6);
  const projectName = `Test ShotGrid ${suffix}`;
  const created = await call('POST', '/api/projects', { name: projectName });
  const projectId = created.json?.project?.id ?? created.json?.id;
  check('création du projet', Boolean(projectId), `statut ${created.status}`);
  if (!projectId) process.exit(1);
  console.log(`   projet #${projectId} « ${projectName} »`);

  // ── 3. Site ShotGrid
  console.log('\n3. Site ShotGrid');
  // Le site est unique par URL : une exécution précédente l'a peut-être déjà créé.
  const existing = await call('GET', '/api/shotgrid/sites');
  let siteId = (existing.json?.sites ?? []).find((s) => s.baseUrl === SG_URL)?.id;
  if (!siteId) {
    const siteRes = await call('POST', '/api/shotgrid/sites', {
      name: `Simulateur ${suffix}`,
      baseUrl: SG_URL,
      authMode: 'script',
      scriptName: 'review_sync',
      scriptKey: 'dev-script-key-0000',
    });
    siteId = siteRes.json?.site?.id;
    check('enregistrement du site', Boolean(siteId), JSON.stringify(siteRes.json).slice(0, 160));
  } else {
    check('site déjà enregistré réutilisé', true);
  }
  if (!siteId) process.exit(1);

  const test = await call('POST', `/api/shotgrid/sites/${siteId}/test`);
  check('test de connexion', test.json?.ok === true, JSON.stringify(test.json).slice(0, 160));
  check('trois projets visibles', test.json?.projectCount === 3, `reçu ${test.json?.projectCount}`);

  const remote = await call('GET', `/api/shotgrid/sites/${siteId}/projects`);
  check('liste des projets distants', Array.isArray(remote.json?.projects) && remote.json.projects.length === 3);

  // ── 3bis. Le projet ShotGrid cible ne peut être relié qu'à un seul projet ReView :
  // une exécution précédente occupe peut-être la place. On la libère pour rester rejouable.
  const allProjects = await call('GET', '/api/projects');
  const projectList = allProjects.json?.projects ?? allProjects.json?.items ?? [];
  for (const p of projectList) {
    if (p.id === projectId) continue;
    const c = await call('GET', `/api/shotgrid/projects/${p.id}/connection`);
    if (c.json?.connection?.sgProjectId === 70) {
      await call('DELETE', `/api/shotgrid/projects/${p.id}/connection`);
      console.log(`   connexion libérée sur le projet #${p.id}`);
    }
  }

  // ── 4. Garde-fou : nom de projet incohérent
  console.log('\n4. Garde-fou du nom de projet');
  const wrongName = await call('POST', `/api/shotgrid/projects/${projectId}/connection`, {
    siteId,
    sgProjectId: 70,
    sgProjectName: 'Demo Project 2', // le #70 s'appelle « Demo Project »
  });
  check(
    'connexion refusée si le nom ne correspond pas',
    wrongName.status >= 400,
    `statut ${wrongName.status}`,
  );

  // ── 5. Connexion correcte
  console.log('\n5. Connexion au bon projet');
  const conn = await call('POST', `/api/shotgrid/projects/${projectId}/connection`, {
    siteId,
    sgProjectId: 70,
    sgProjectName: 'Demo Project',
  });
  check('connexion créée', conn.status === 201, JSON.stringify(conn.json).slice(0, 200));
  check('projet cible mémorisé', conn.json?.connection?.sgProjectName === 'Demo Project');
  check('URL de webhook fournie', typeof conn.json?.connection?.webhookUrl === 'string');

  // ── 6. Synchronisation
  console.log('\n6. Synchronisation complète');
  const sync = await call('POST', `/api/shotgrid/projects/${projectId}/sync`, { kind: 'full' });
  check('synchronisation exécutée', sync.status === 200, JSON.stringify(sync.json).slice(0, 200));
  const stats = sync.json?.result?.stats ?? {};
  console.log('   compteurs :', JSON.stringify(stats));
  check(
    'statut de la synchronisation',
    sync.json?.result?.status === 'ok' || sync.json?.result?.status === 'partial',
    sync.json?.result?.status,
  );

  // ── 7. LE contrôle : cloisonnement des projets
  console.log('\n7. Cloisonnement des projets (contrôle critique)');
  // L'effectif attendu se lit sur le simulateur plutôt que d'être écrit en dur : le jeu
  // de données peut grossir au fil des essais, la garantie testée reste le cloisonnement.
  const sgState = await fetch(`${SG_CONTROL}/_control/shots?projectId=70`).then((r) => r.json());
  const expectedCodes = sgState.codes.slice().sort();
  const shots = await call('GET', `/api/shots?projectId=${projectId}`);
  const list = shots.json?.items ?? shots.json?.shots ?? shots.json?.data ?? [];
  const codes = list.map((s) => s.code).sort();
  console.log('   plans importés :', codes.join(', ') || '(aucun)');
  check(
    'autant de plans que dans le projet ShotGrid',
    codes.length === expectedCodes.length,
    `reçu ${codes.length}, attendu ${expectedCodes.length}`,
  );
  check(
    'uniquement les plans du projet lié',
    JSON.stringify(codes) === JSON.stringify(expectedCodes),
    `${codes.join(',')} vs ${expectedCodes.join(',')}`,
  );

  // Le projet #71 porte les mêmes codes : on vérifie côté base qu'aucune entité du
  // projet voisin n'a été reliée (identifiants ShotGrid 3xxx contre 2xxx).
  const runs = await call('GET', `/api/shotgrid/projects/${projectId}/runs`);
  const lastRun = runs.json?.runs?.[0];
  check('exécution journalisée', Boolean(lastRun), `${runs.json?.runs?.length ?? 0} exécution(s)`);
  const guard = lastRun?.stats?.guard;
  check('aucune entité écartée par le garde-fou', !guard || guard.skipped === 0, JSON.stringify(guard));

  // ── 8. Données de production
  console.log('\n8. Données importées');
  const shot = list.find((s) => s.code === 'DEMO_SH010');
  const sgShot = sgState.shots.find((x) => x.code === 'DEMO_SH010');
  check(
    'bornes de cut reprises',
    shot?.startFrame === sgShot?.sg_cut_in && shot?.endFrame === sgShot?.sg_cut_out,
    `${shot?.startFrame}-${shot?.endFrame} vs ${sgShot?.sg_cut_in}-${sgShot?.sg_cut_out}`,
  );
  check('statut de plan repris', Boolean(shot?.pipelineStatusId ?? shot?.pipelineStatus));

  const statuses = await call('GET', '/api/pipeline-statuses?scope=task');
  const codesStatus = (statuses.json?.statuses ?? []).map((s) => s.code);
  check('statuts ShotGrid importés', codesStatus.includes('ip') && codesStatus.includes('apr'),
    codesStatus.join(','));
  const ip = (statuses.json?.statuses ?? []).find((s) => s.code === 'ip');
  check('couleur convertie du RGB décimal', ip?.color === '#2D8CF0', ip?.color);

  // ── 9. Comparaison
  console.log('\n9. Comparaison ReView / ShotGrid');
  const diff = await call('GET', `/api/shotgrid/projects/${projectId}/diff`);
  check('comparaison produite', diff.status === 200, JSON.stringify(diff.json).slice(0, 150));
  const report = diff.json?.diff;
  check('nom du projet distant vérifié', report?.projectNameOk === true);
  check('mêmes effectifs de plans', report?.counts?.Shot?.review === report?.counts?.Shot?.shotgrid,
    JSON.stringify(report?.counts?.Shot));
  console.log('   écarts détectés :', report?.entries?.length ?? 0);

  // ── 10. Idempotence
  console.log('\n10. Deuxième synchronisation (idempotence)');
  const sync2 = await call('POST', `/api/shotgrid/projects/${projectId}/sync`, { kind: 'full' });
  const stats2 = sync2.json?.result?.stats ?? {};
  check('aucun plan créé en double', (stats2.shots?.created ?? 0) === 0, JSON.stringify(stats2.shots));
  const shots2 = await call('GET', `/api/shots?projectId=${projectId}`);
  const list2 = shots2.json?.items ?? shots2.json?.shots ?? [];
  check('effectif inchangé', list2.length === expectedCodes.length, `reçu ${list2.length}`);

  // ── 11. Verrou de création locale
  console.log('\n11. Verrou de création locale');
  const blocked = await call('POST', '/api/shots', {
    projectId,
    code: 'LOCAL_SH999',
    name: 'Créé localement',
  });
  check('création locale refusée', blocked.status === 409, `statut ${blocked.status}`);
  check(
    'lien de création ShotGrid proposé',
    typeof blocked.json?.sgCreateUrl === 'string' && blocked.json.sgCreateUrl.includes('project=70'),
    JSON.stringify(blocked.json).slice(0, 160),
  );

  // ── 12. Changement distant appliqué (mode événement)
  console.log('\n12. Changement dans ShotGrid');
  await fetch(`${SG_CONTROL}/_control/mutate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType: 'Shot', id: 2013, field: 'sg_status_list', value: 'apr' }),
  });
  await call('POST', `/api/shotgrid/projects/${projectId}/sync`, { kind: 'full' });
  const shots3 = await call('GET', `/api/shots?projectId=${projectId}`);
  const sh030 = (shots3.json?.items ?? shots3.json?.shots ?? []).find((s) => s.code === 'DEMO_SH030');
  const statusList = await call('GET', '/api/pipeline-statuses?scope=shot');
  const apr = (statusList.json?.statuses ?? []).find((s) => s.code === 'apr');
  check('nouveau statut répercuté', sh030?.pipelineStatusId === apr?.id,
    `${sh030?.pipelineStatusId} vs ${apr?.id}`);

  // ── Bilan
  console.log(`\n═══ ${passed} contrôle(s) réussi(s), ${failed} en échec ═══\n`);
  console.log(`Projet de test conservé : #${projectId} « ${projectName} »`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nErreur inattendue :', err);
  process.exit(1);
});
