-- ─────────────────────────────────────────────────────────────────────────────
-- Unicités métier (vague 2 — échelle)
-- ─────────────────────────────────────────────────────────────────────────────
-- Les chemins `ensure*` de l'API v1 sont des « chercher puis créer ». `ensureSequence`,
-- `ensureShot` et `ensureAsset` rattrapent la violation d'unicité (`recoverUniqueViolation`)
-- parce que leur contrainte existe ; `ensureTask` et `ensureVersion` avaient le même code de
-- rattrapage en face de RIEN. Deux publications simultanées — le cas normal d'une ferme de
-- rendu, ou d'une synchro ShotGrid concurrente d'un publish DCC — créaient donc deux tâches
-- jumelles, ou deux V02 sur la même tâche : un travail coupé en deux, sans erreur nulle part.
--
-- Chaque contrainte est précédée de sa reprise de données. On RENOMME les doublons plutôt
-- que d'en supprimer : le suffixe est laid, l'effacement d'une version et de ses médias le
-- serait davantage. Le suffixe reprend l'id, donc la reprise est idempotente et lisible.

-- ── Task : (parent, étape, nom) ──────────────────────────────────────────────────
-- Portée volontairement limitée aux tâches QUI ONT une étape (les NULL sont distincts en
-- SQL) : une tâche née d'un commentaire de review tire son nom du texte du retour, et deux
-- retours identiques sur le même plan sont légitimes.
UPDATE "Task" t
SET "name" = t."name" || ' #' || t."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "shotId", "departmentId", "name" ORDER BY "id") AS rn
  FROM "Task"
  WHERE "shotId" IS NOT NULL AND "departmentId" IS NOT NULL
) d
WHERE d."id" = t."id" AND d.rn > 1;

UPDATE "Task" t
SET "name" = t."name" || ' #' || t."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "assetId", "departmentId", "name" ORDER BY "id") AS rn
  FROM "Task"
  WHERE "assetId" IS NOT NULL AND "departmentId" IS NOT NULL
) d
WHERE d."id" = t."id" AND d.rn > 1;

CREATE UNIQUE INDEX "Task_shotId_departmentId_name_key" ON "Task"("shotId", "departmentId", "name");
CREATE UNIQUE INDEX "Task_assetId_departmentId_name_key" ON "Task"("assetId", "departmentId", "name");

-- ── Version : (parent, nom) ──────────────────────────────────────────────────────
-- La corbeille est DANS la portée : un numéro qui a servi ne resservira pas. C'est déjà le
-- parti pris du code — `VersionService.autoName` compte les versions supprimées, et
-- `ensureVersion` sait répondre `VERSION_IN_TRASH` à la violation.
UPDATE "Version" v
SET "name" = v."name" || ' #' || v."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "taskId", "name" ORDER BY "id") AS rn
  FROM "Version" WHERE "taskId" IS NOT NULL
) d
WHERE d."id" = v."id" AND d.rn > 1;

UPDATE "Version" v
SET "name" = v."name" || ' #' || v."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "assetId", "name" ORDER BY "id") AS rn
  FROM "Version" WHERE "assetId" IS NOT NULL
) d
WHERE d."id" = v."id" AND d.rn > 1;

CREATE UNIQUE INDEX "Version_taskId_name_key" ON "Version"("taskId", "name");
CREATE UNIQUE INDEX "Version_assetId_name_key" ON "Version"("assetId", "name");

-- ── Shot sans séquence : le trou de la purge ─────────────────────────────────────
-- `@@unique([projectId, sequenceId, code])` ne protège pas les plans hors séquence, les
-- NULL étant distincts en SQL. Or purger une séquence remet `sequenceId` à null sur ses
-- plans (SetNull) : SQ010/SH010 et SQ020/SH010 devenaient deux lignes homonymes que le
-- `findFirst` d'`ensureShot` départageait au hasard — une publication DCC atterrissait sur
-- le travail d'une autre séquence.
--
-- L'index est restreint aux plans VIVANTS, à dessein : le SetNull d'une purge porte sur des
-- plans en corbeille (une séquence supprimée y emmène les siens), et il ne doit jamais
-- pouvoir échouer. Deux plans en corbeille peuvent donc partager un code hors séquence ;
-- deux plans actifs, non.
UPDATE "Shot" s
SET "code" = s."code" || '-' || s."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "projectId", "code" ORDER BY "id") AS rn
  FROM "Shot" WHERE "sequenceId" IS NULL AND "deletedAt" IS NULL
) d
WHERE d."id" = s."id" AND d.rn > 1;

CREATE UNIQUE INDEX "Shot_project_code_no_sequence_unique" ON "Shot"("projectId", "code")
  WHERE "sequenceId" IS NULL AND "deletedAt" IS NULL;

-- ── Montage de projet : un seul par projet ───────────────────────────────────────
-- Même trou de NULL sur `@@unique([projectId, sequenceId])` : deux onglets ouverts au même
-- instant créaient deux montages de projet, dont un seul recevait ensuite les révisions.
-- `TimelineService.ensure` rattrape déjà l'échec de création en relisant le gagnant.
--
-- Reprise sans perte : les révisions et les retours des doublons sont rapatriés sur le
-- montage conservé (le plus ancien), les révisions renumérotées à la suite des siennes pour
-- ne pas heurter `@@unique([timelineId, revision])`.
WITH keeper AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id"
  FROM "Timeline" WHERE "sequenceId" IS NULL
  ORDER BY "projectId", "id"
), moved AS (
  SELECT s."id" AS snapshot_id,
         k."id" AS keeper_id,
         COALESCE((SELECT max(s2."revision") FROM "TimelineSnapshot" s2 WHERE s2."timelineId" = k."id"), 0)
           + row_number() OVER (PARTITION BY k."id" ORDER BY s."createdAt", s."id") AS new_revision
  FROM "TimelineSnapshot" s
  JOIN "Timeline" t ON t."id" = s."timelineId"
  JOIN keeper k ON k."projectId" = t."projectId"
  WHERE t."sequenceId" IS NULL AND t."id" <> k."id"
)
UPDATE "TimelineSnapshot" s
SET "timelineId" = m.keeper_id, "revision" = m.new_revision
FROM moved m WHERE m.snapshot_id = s."id";

WITH keeper AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id"
  FROM "Timeline" WHERE "sequenceId" IS NULL
  ORDER BY "projectId", "id"
)
UPDATE "Comment" c
SET "timelineId" = k."id"
FROM "Timeline" t JOIN keeper k ON k."projectId" = t."projectId"
WHERE c."timelineId" = t."id" AND t."sequenceId" IS NULL AND t."id" <> k."id";

WITH keeper AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id"
  FROM "Timeline" WHERE "sequenceId" IS NULL
  ORDER BY "projectId", "id"
)
DELETE FROM "Timeline" t
USING keeper k
WHERE t."projectId" = k."projectId" AND t."sequenceId" IS NULL AND t."id" <> k."id";

CREATE UNIQUE INDEX "Timeline_project_unique_no_sequence" ON "Timeline"("projectId")
  WHERE "sequenceId" IS NULL;
