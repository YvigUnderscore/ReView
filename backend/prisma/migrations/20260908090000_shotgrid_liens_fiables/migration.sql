-- ─────────────────────────────────────────────────────────────────────────────
-- Correspondances ShotGrid fiables (reliquats de la phase 48)
-- ─────────────────────────────────────────────────────────────────────────────
-- Trois défauts d'une même table, `ShotgridLink`, plus une colonne morte qui la
-- côtoyait. Ils partent ensemble parce qu'ils se répondent : un lien qui ment et un lien
-- qui survit à son entité produisent le même symptôme — une synchronisation qui écrit
-- au mauvais endroit chez le client.
--
-- Ce que cette migration NE fait PAS : toucher au site ShotGrid. Aucune Note, aucune
-- Version, aucun Attachment distant n'est supprimé. Le produit ne détruit jamais rien à
-- distance (`ShotgridClient.remove` n'a aucun appelant) ; effacer un commentaire ici
-- efface le commentaire et sa correspondance, pas la note du superviseur là-bas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `Comment.screenshotKey` — colonne sans écrivain
-- ─────────────────────────────────────────────────────────────────────────────
-- Déclarée « capture annotée (MinIO) », lue en priorité par `ShotgridNoteSync` pour
-- joindre la frame annotée à une note. Aucun service, aucun worker, aucun seed, aucune
-- migration ne l'a jamais écrite : le repli — extraire et composer la frame à la volée —
-- était l'unique chemin réel. La colonne et la branche qui la lit partent ensemble.
-- Le lot `20260822093000_colonnes_mortes` l'avait déjà relevée et laissée, faute de
-- pouvoir toucher au service ShotGrid dans ce lot-là.
ALTER TABLE "Comment" DROP COLUMN "screenshotKey";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Liens `media` menteurs — (sgType, sgId) désignant deux entités différentes
-- ─────────────────────────────────────────────────────────────────────────────
-- L'import d'un média enregistrait `sgType = 'Attachment'` avec, en `sgId`, l'identifiant
-- de la **Version** dont le champ portait le fichier. Le type et l'identifiant ne
-- parlaient pas de la même entité, et les espaces d'identifiants de ShotGrid étant
-- séparés par type, `Attachment #412` et `Version #412` coexistent sans peine : le lien
-- menteur pouvait effacer un lien juste, `upsertLink` retirant tout conflit.
--
-- Ces lignes sont SUPPRIMÉES, pas réparées. L'identifiant d'Attachment correct ne se
-- déduit d'aucune donnée locale : il ne vit que sur le site, et le retrouver supposerait
-- d'interroger ShotGrid depuis une migration. Elles sont par ailleurs sans lecteur —
-- aucun code ne consulte une correspondance de type `media` — donc rien ne se dégrade :
-- un média importé reste rattaché à sa version ShotGrid par ses métadonnées
-- (`importedFromShotgrid`, `sgVersionId`, `sgField`), qui, elles, disent vrai.
-- Le seul écrivain de `localType = 'media'` étant le code fautif, la sélection est exacte.
DELETE FROM "ShotgridLink" WHERE "localType" = 'media';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Liens orphelins — un lien qui survit à ce qu'il désigne
-- ─────────────────────────────────────────────────────────────────────────────
-- `ShotgridLink` est polymorphe : `localType` + `localId` pointent vers l'un des douze
-- modèles liables, sans clé étrangère possible, donc sans `ON DELETE CASCADE`. Aucune
-- suppression du produit ne retirait le lien correspondant — ni celle d'un commentaire,
-- ni celles d'un média, d'une version, d'un plan, d'un asset, d'une séquence, d'un
-- épisode, d'une tâche, d'une playlist, d'un statut ou d'un compte. La synchronisation
-- suivante travaillait sur un fantôme.
--
-- L'index d'abord : le nettoyage ci-dessous et les déclencheurs cherchent par
-- (localType, localId) SANS connexion. L'unique préfixé par `connectionId` ne peut pas
-- les servir — sans cet index, chaque suppression d'entité parcourait toute la table.
CREATE INDEX "ShotgridLink_localType_localId_idx" ON "ShotgridLink"("localType", "localId");

-- Nettoyage de l'existant. Un `localType` inconnu (écrit par une version antérieure,
-- ou resté d'un type retiré depuis) part aussi : rien ne saurait plus le résoudre.
DELETE FROM "ShotgridLink" l
WHERE (l."localType" = 'episode'        AND NOT EXISTS (SELECT 1 FROM "Episode"        e WHERE e.id = l."localId"))
   OR (l."localType" = 'sequence'       AND NOT EXISTS (SELECT 1 FROM "Sequence"       s WHERE s.id = l."localId"))
   OR (l."localType" = 'shot'           AND NOT EXISTS (SELECT 1 FROM "Shot"           s WHERE s.id = l."localId"))
   OR (l."localType" = 'asset'          AND NOT EXISTS (SELECT 1 FROM "Asset"          a WHERE a.id = l."localId"))
   OR (l."localType" = 'task'           AND NOT EXISTS (SELECT 1 FROM "Task"           t WHERE t.id = l."localId"))
   OR (l."localType" = 'version'        AND NOT EXISTS (SELECT 1 FROM "Version"        v WHERE v.id = l."localId"))
   OR (l."localType" = 'media'          AND NOT EXISTS (SELECT 1 FROM "MediaObject"    m WHERE m.id = l."localId"))
   OR (l."localType" = 'pipelineStatus' AND NOT EXISTS (SELECT 1 FROM "PipelineStatus" p WHERE p.id = l."localId"))
   OR (l."localType" = 'reviewStatus'   AND NOT EXISTS (SELECT 1 FROM "ReviewStatus"   r WHERE r.id = l."localId"))
   OR (l."localType" = 'user'           AND NOT EXISTS (SELECT 1 FROM "User"           u WHERE u.id = l."localId"))
   OR (l."localType" = 'playlist'       AND NOT EXISTS (SELECT 1 FROM "Playlist"       p WHERE p.id = l."localId"))
   OR (l."localType" = 'comment'        AND NOT EXISTS (SELECT 1 FROM "Comment"        c WHERE c.id = l."localId"))
   OR l."localType" NOT IN (
        'episode', 'sequence', 'shot', 'asset', 'task', 'version',
        'media', 'pipelineStatus', 'reviewStatus', 'user', 'playlist', 'comment');

-- La garantie, maintenant. Elle vit dans la base et non dans les services, pour deux
-- raisons qu'aucun code applicatif ne pouvait couvrir :
--
--   1. la plupart des suppressions n'existent pas en TypeScript. Purger un plan efface
--      ses tâches, ses versions, ses médias et leurs commentaires par cascade SQL :
--      aucun service ne les voit passer, donc aucun service ne pouvait nettoyer leurs
--      liens. Corriger le seul `CommentService.remove()` aurait laissé la majorité des
--      orphelins se former ;
--   2. un déclencheur s'exécute dans la transaction de la suppression. Le lien ne peut
--      survivre ni une milliseconde à son entité, ni à un rollback qui l'annulerait.
--
-- `FOR EACH ROW` et non `FOR EACH STATEMENT` : les triggers par ligne se déclenchent de
-- façon certaine sur les suppressions en cascade, ce qui est précisément le cas
-- majoritaire ici. Le coût est une recherche sur index par ligne effacée.
CREATE OR REPLACE FUNCTION shotgrid_link_purge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "ShotgridLink"
   WHERE "localType" = TG_ARGV[0] AND "localId" = OLD.id;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION shotgrid_link_purge() IS
  'Retire la correspondance ShotGrid d''une entité supprimée. Le type local est passé en argument du déclencheur ; voir backend/src/services/shotgrid/shotgridLinks.ts (LOCAL_TYPES).';

CREATE TRIGGER shotgrid_link_purge_episode        AFTER DELETE ON "Episode"        FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('episode');
CREATE TRIGGER shotgrid_link_purge_sequence       AFTER DELETE ON "Sequence"       FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('sequence');
CREATE TRIGGER shotgrid_link_purge_shot           AFTER DELETE ON "Shot"           FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('shot');
CREATE TRIGGER shotgrid_link_purge_asset          AFTER DELETE ON "Asset"          FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('asset');
CREATE TRIGGER shotgrid_link_purge_task           AFTER DELETE ON "Task"           FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('task');
CREATE TRIGGER shotgrid_link_purge_version        AFTER DELETE ON "Version"        FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('version');
CREATE TRIGGER shotgrid_link_purge_media          AFTER DELETE ON "MediaObject"    FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('media');
CREATE TRIGGER shotgrid_link_purge_pipelinestatus AFTER DELETE ON "PipelineStatus" FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('pipelineStatus');
CREATE TRIGGER shotgrid_link_purge_reviewstatus   AFTER DELETE ON "ReviewStatus"   FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('reviewStatus');
CREATE TRIGGER shotgrid_link_purge_user           AFTER DELETE ON "User"           FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('user');
CREATE TRIGGER shotgrid_link_purge_playlist       AFTER DELETE ON "Playlist"       FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('playlist');
CREATE TRIGGER shotgrid_link_purge_comment        AFTER DELETE ON "Comment"        FOR EACH ROW EXECUTE FUNCTION shotgrid_link_purge('comment');
