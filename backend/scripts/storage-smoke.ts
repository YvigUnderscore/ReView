/**
 * Smoke test du StorageService (vérification 8.1) :
 *  1. ensureBucket
 *  2. upload via URL présignée PUT (HTTP direct, comme le navigateur)
 *  3. lecture via URL présignée GET
 *  4. nettoyage
 *
 * Lancer : `tsx scripts/storage-smoke.ts` (avec MinIO démarré + .env configuré).
 */
import { storage } from '../src/services/StorageService';

async function main(): Promise<void> {
  const key = `__smoke__/${Date.now()}.txt`;
  const payload = 'ReView 2.0 storage smoke test';

  await storage.ensureBucket();
  console.info('✓ bucket OK');

  const putUrl = await storage.getPresignedPutUrl(key, 'text/plain');
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: payload,
  });
  if (!putRes.ok) throw new Error(`PUT présigné échoué : ${putRes.status}`);
  console.info('✓ upload présigné PUT OK');

  const getUrl = await storage.getPresignedGetUrl(key);
  const getRes = await fetch(getUrl);
  const body = await getRes.text();
  if (body !== payload) throw new Error(`Contenu lu incohérent : « ${body} »`);
  console.info('✓ lecture présignée GET OK');

  await storage.deleteObject(key);
  console.info('✓ suppression OK');
  console.info('✅ StorageService opérationnel — aucun fichier écrit sur le FS du backend.');
}

main().catch((e) => {
  console.error('❌ smoke test échoué :', e);
  process.exit(1);
});
